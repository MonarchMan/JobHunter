import { describe, expect, it } from 'vitest';
import { profileToResumeContent, renderResumeHtml, resumeTemplates } from '../src/index.js';

describe('resume templates', () => {
  it('publishes two versioned templates and excludes internal matching preferences', () => {
    expect(resumeTemplates).toHaveLength(2);
    expect(resumeTemplates[0]).toMatchObject({
      key: 'technical-blueprint',
      version: 1,
      name: '简洁单页',
    });
    expect(resumeTemplates[1]).toMatchObject({
      key: 'clean-single-column',
      version: 1,
      name: '标准单页',
    });
    const content = profileToResumeContent({
      basicInfo: {
        name: '候选人',
        phone: '13800000000',
        email: 'candidate@example.com',
        location: '上海',
        website: null,
      },
      targetRoles: ['Agent 工程师'],
      preferences: {
        locations: ['上海'],
        companySizes: ['large'],
        employmentTypes: ['全职'],
        excludedTerms: ['外包'],
        remoteAccepted: true,
      },
      education: [],
      workExperience: [],
      projects: [],
      works: [],
      competitions: [],
      certificates: [],
      languages: [],
      professionalSkills: null,
      selfEvaluation: null,
      skills: [{ name: 'TypeScript', level: 'proficient', evidence: [] }],
      domains: ['大模型'],
      yearsOfExperience: 2,
      managementExperience: false,
    });
    expect(content.professionalSkills).toBe('技术技能：TypeScript。\n相关领域：大模型。');
    expect(JSON.stringify(content)).not.toContain('外包');
    const html = renderResumeHtml({ templateKey: 'technical-blueprint', content });
    expect(html).toContain('候选人');
    expect(html).toContain('class="template-one-page"');
    expect(html).toContain('class="contact-chip"');
    expect(html).toContain('class="contact-icon"');
    expect(html).toContain('class="section-icon"');
    expect(html).toContain('<svg');
    expect(html).toContain('background:#f7f9fc');
    expect(html).toContain('<div class="identity-title">');
    expect(html).toContain('<ul class="detail-list skills-list"');
    expect(html).toContain(
      '<li data-placeholder="输入一条完整的技能描述">技术技能：TypeScript。</li>',
    );
    expect(html).toContain('<li data-placeholder="输入一条完整的技能描述">相关领域：大模型。</li>');
    expect(html).not.toContain('data-section-id="target"');
    expect(html).not.toContain('data-select-section');
    expect(html).not.toContain('自我评价</h2>');

    const interactive = renderResumeHtml({
      templateKey: 'technical-blueprint',
      content: {
        ...content,
        formatting: { basic: { fontSize: 15, letterSpacing: 0.5, lineHeight: 1.6 } },
      },
      interactive: true,
      activeSection: 'basic',
    });
    expect(interactive).toContain('data-field="basicInfo.name"');
    expect(interactive).toContain('data-field="professionalSkills" contenteditable="true"');
    expect(interactive).toContain('contenteditable="true"');
    expect(interactive).toContain('--section-font-size:15px');
    expect(interactive).not.toContain('data-select-section');
  });

  it('escapes user text', () => {
    const content = profileToResumeContent({
      basicInfo: {
        name: '<script>alert(1)</script>',
        phone: null,
        email: null,
        location: null,
        website: null,
      },
      targetRoles: [],
      preferences: {
        locations: [],
        companySizes: [],
        employmentTypes: [],
        excludedTerms: [],
        remoteAccepted: null,
      },
      education: [],
      workExperience: [],
      projects: [],
      works: [],
      competitions: [],
      certificates: [],
      languages: [],
      professionalSkills: null,
      selfEvaluation: null,
      skills: [],
      domains: [],
      yearsOfExperience: null,
      managementExperience: null,
    });
    const html = renderResumeHtml({ templateKey: 'clean-single-column', content });
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });
});
