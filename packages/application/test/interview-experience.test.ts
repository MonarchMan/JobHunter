import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parsePersonalExperienceText } from '@jobhunter/domain';
import {
  personalExperienceTemplateMarkdown,
  renderPersonalExperienceMarkdown,
} from '../src/interview/index.js';

describe('personal interview experience template', () => {
  it('keeps the downloadable template byte-identical to the repository reference', async () => {
    const reference = await readFile(
      new URL('../../../docs/templates/personal-interview-experience-v1.md', import.meta.url),
      'utf8',
    );

    expect(personalExperienceTemplateMarkdown).toBe(reference);
    expect(parsePersonalExperienceText(reference).experiences[0]?.questions).toHaveLength(2);
  });

  it('routes online entry through a parseable standard Markdown artifact', () => {
    const markdown = renderPersonalExperienceMarkdown({
      sequenceNo: 1,
      company: '示例科技',
      role: '后端工程师',
      stage: '一面',
      occurredOn: '2026-08-30',
      outcome: null,
      difficulty: null,
      tags: ['Java', '数据库'],
      notes: '需要补充容量规划。',
      questions: [
        {
          sequenceNo: 1,
          question: '如何定位慢查询？',
          answer: null,
          reflection: '补充执行计划示例。',
          questionEvidence: null,
          answerEvidence: null,
        },
      ],
    });
    const parsed = parsePersonalExperienceText(markdown);

    expect(markdown).toContain('模板版本：personal-experience@v1');
    expect(parsed.experiences[0]).toMatchObject({
      company: '示例科技',
      role: '后端工程师',
      questions: [expect.objectContaining({ question: '如何定位慢查询？', answer: null })],
    });
  });
});
