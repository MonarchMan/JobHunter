import { describe, expect, it } from 'vitest';
import {
  profileToResumeContent,
  renderResumeHtml,
  resumeTemplates,
  resumeDocumentContentSchema,
  addResumeSection,
  removeResumeSection,
  isResumeSectionAdded,
  initializeResumeSections,
  type ResumeDocumentContent,
} from '../src/index.js';

it('locks down interactive documents without breaking exported HTML editing', () => {
  const input = { templateKey: 'technical-blueprint' as const, content: blockFixture() };
  const html = renderResumeHtml({ ...input, interactive: true, editable: true });
  expect(html).toContain("script-src 'none'");
  expect(html).toContain("default-src 'none'");
  expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('<style>'));
  expect(html).not.toContain('<script>');
  expect(renderResumeHtml({ ...input, editable: true })).toContain('<script>');
});

/** 构造仅包含描述和自定义内容块的投递草稿，验证结构不会被 Schema 丢弃。 */
function blockFixture(): ResumeDocumentContent {
  return resumeDocumentContentSchema.parse({
    basicInfo: { name: '候选人', phone: null, email: null, location: null, website: null },
    targetRoles: [],
    education: [],
    workExperience: [],
    works: [],
    competitions: [],
    certificates: [],
    languages: [],
    professionalSkills: null,
    selfEvaluation: null,
    projects: [
      {
        name: '测试项目',
        role: null,
        startDate: null,
        endDate: null,
        highlights: ['旧职责'],
        descriptionBlocks: [
          { type: 'paragraph', text: '项目介绍\n第二行' },
          { type: 'bullet', text: '设计系统' },
          { type: 'bullet', text: '<img src=x onerror=alert(1)>' },
          { type: 'paragraph', text: '总结' },
        ],
      },
    ],
    textRows: {
      certificates: [
        {
          cells: [
            [
              { type: 'paragraph', text: '全宽介绍\n第二段' },
              { type: 'bullet', text: '单栏职责' },
            ],
          ],
        },
        { cells: ['', '中间栏', '右栏'] },
        { cells: ['', ''] },
      ],
    },
  });
}

describe('resume templates', () => {
  it.each(resumeTemplates)(
    'persists added empty sections and clears only the removed section in $name',
    (template) => {
      const initial = blockFixture();
      const initialized = initializeResumeSections(initial);
      expect(isResumeSectionAdded({ ...initialized, projects: [] }, 'projects')).toBe(true);
      expect(isResumeSectionAdded(initial, 'languages')).toBe(false);
      const added = addResumeSection(initial, 'languages');
      const restored = resumeDocumentContentSchema.parse(JSON.parse(JSON.stringify(added)));
      expect(isResumeSectionAdded(restored, 'languages')).toBe(true);
      expect(addResumeSection(restored, 'languages')).toBe(restored);
      expect(
        renderResumeHtml({ templateKey: template.key, content: restored, interactive: true }),
      ).toContain('data-section-id="languages"');
      expect(renderResumeHtml({ templateKey: template.key, content: restored })).not.toMatch(
        /<section[^>]*data-section-id="languages"/u,
      );
      const removed = removeResumeSection(
        {
          ...restored,
          textRows: {
            ...restored.textRows,
            projects: [{ afterBlock: 'projects.0.header', cells: ['新增说明'] }],
          },
          hiddenBlocks: ['projects.0.role'],
          formatting: { projects: { fontSize: 12, lineHeight: 1.5, letterSpacing: 0 } },
        },
        'projects',
      );
      expect(removed.projects).toEqual([]);
      expect(removed.textRows?.projects).toBeUndefined();
      expect(removed.formatting?.projects).toBeUndefined();
      expect(removed.hiddenBlocks).toEqual([]);
      expect(removed.basicInfo).toEqual(initial.basicInfo);
      expect(isResumeSectionAdded(removed, 'projects')).toBe(false);
      expect(
        renderResumeHtml({ templateKey: template.key, content: removed, interactive: true }),
      ).not.toMatch(/<section[^>]*data-section-id="projects"/u);
      expect(addResumeSection(removed, 'projects').projects[0]?.name).toBe('');
      const skillContent = {
        ...initial,
        professionalSkills: '旧技能',
        professionalSkillBlocks: [
          { type: 'paragraph' as const, text: '普通技能段落' },
          { type: 'bullet' as const, text: '技能列表项' },
        ],
      };
      const html = renderResumeHtml({ templateKey: template.key, content: skillContent });
      expect(html).toContain('<p>普通技能段落</p>');
      expect(html).toContain('<li>技能列表项</li>');
      expect(html).not.toContain('旧技能');
    },
  );

  it.each(resumeTemplates)(
    'anchors inserted rows and deletes only the selected block in $name',
    (template) => {
      const content = resumeDocumentContentSchema.parse({
        ...blockFixture(),
        hiddenBlocks: ['projects.0.description'],
        textRows: {
          projects: [
            { afterBlock: 'projects.0.header', cells: ['标题后新增内容'] },
            { afterBlock: 'projects.0.description', cells: ['删除描述后保留的内容'] },
          ],
        },
      });
      const html = renderResumeHtml({ templateKey: template.key, content });
      expect(html).toContain('测试项目');
      expect(html).not.toContain('项目介绍');
      expect(html).toContain('删除描述后保留的内容');
      expect(html.indexOf('标题后新增内容')).toBeLessThan(html.indexOf('删除描述后保留的内容'));
      expect(html).not.toContain('data-insert-block');
      expect(html).not.toContain('data-delete-block');
      const editing = renderResumeHtml({ templateKey: template.key, content, interactive: true });
      expect(editing).toContain('position:absolute;right:0;top:100%');
      expect(editing).not.toContain('data-toggle-list');
    },
  );

  it.each(resumeTemplates)('preserves mixed paragraphs and lists in $name', (template) => {
    const content = blockFixture();
    const editing = renderResumeHtml({ templateKey: template.key, content, interactive: true });
    expect(editing).toContain('data-field="projects.0.descriptionBlocks"');
    expect(editing).toContain('data-insert-block="projects:projects.0.header.1"');
    expect(editing).toContain('data-delete-block="projects.0.description"');
    expect(editing).toContain('data-insert-row="certificates.0.3"');
    expect(editing).not.toMatch(/<section[^>]*data-section-id="languages"/u);
    expect(editing).not.toMatch(/<li[^>]*contenteditable/u);
    const html = renderResumeHtml({ templateKey: template.key, content });
    expect(html).toContain('<p>项目介绍\n第二行</p><ul class="detail-list"><li>设计系统</li>');
    expect(html).toContain('</ul><p>总结</p>');
    expect(html).not.toContain('旧职责');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('data-toggle-list');
    expect(html).not.toContain('data-remove-row');
    expect(html).not.toContain('data-insert-entry');
    expect(html).not.toContain('data-insert-row');
    expect(html).toContain('全宽介绍\n第二段');
    expect(html).toContain('style="--row-columns:3"><div class="text-cell"></div>');
    expect(html).not.toContain('style="--row-columns:2"');
    expect(resumeDocumentContentSchema.parse(JSON.parse(JSON.stringify(content)))).toEqual(content);
  });

  it('restores legacy highlights and rejects more than three columns', () => {
    const content = blockFixture();
    const project = content.projects[0];
    if (!project) throw new Error('测试数据必须包含项目');
    delete project.descriptionBlocks;
    const html = renderResumeHtml({ templateKey: 'technical-blueprint', content });
    expect(html).toContain('<li>旧职责</li>');
    expect(
      resumeDocumentContentSchema.safeParse({
        ...content,
        textRows: { skills: [{ cells: ['', '', '', ''] }] },
      }).success,
    ).toBe(false);
  });
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
    expect(html).toContain('<li>技术技能：TypeScript。</li>');
    expect(html).toContain('<li>相关领域：大模型。</li>');
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
    expect(interactive).toContain('data-field="professionalSkillBlocks"');
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
