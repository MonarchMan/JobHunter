import { describe, expect, it } from 'vitest';
import { profileToResumeContent, renderResumeHtml, resumeTemplates } from '../src/index.js';

describe('resume templates', () => {
  it('publishes two versioned templates and excludes internal matching preferences', () => {
    expect(resumeTemplates).toHaveLength(2);
    const content = profileToResumeContent({
      basicInfo: { name: '候选人', phone: null, email: null, location: null, website: null },
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
    expect(content.professionalSkills).toBe('TypeScript');
    expect(JSON.stringify(content)).not.toContain('外包');
    const html = renderResumeHtml({ templateKey: 'technical-blueprint', content });
    expect(html).toContain('候选人');
    expect(html).not.toContain('自我评价</h2>');
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
