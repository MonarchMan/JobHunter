import { describe, expect, it } from 'vitest';
import {
  assertExperienceDraftCanBeAccepted,
  DomainError,
  parsePersonalExperienceText,
} from '../src/index.js';

describe('personal interview experience parsing', () => {
  it('normalizes the standard structure without inventing missing answers', () => {
    const result = parsePersonalExperienceText(
      `\uFEFF# 个人面试经历\r\n\r\n## 经历 1\r\n\r\n- 公司：示例科技   \r\n- 岗位：后端工程师\r\n- 面试日期：2026-08-30\r\n- 标签：Java、数据库、Java\r\n\r\n### 问答\r\n\r\n#### Q1\r\n\r\n问题：如何定位一次慢查询？\r\n\r\n回答：先查看执行计划。\r\n\r\n#### Q2\r\n\r\n问题：为什么选择这个索引？\r\n\r\n回答：\r\n`,
    );

    expect(result.normalizedText).not.toContain('\r');
    expect(result.experiences).toEqual([
      expect.objectContaining({
        company: '示例科技',
        role: '后端工程师',
        occurredOn: '2026-08-30',
        tags: ['Java', '数据库'],
        questions: [
          expect.objectContaining({ question: '如何定位一次慢查询？', answer: '先查看执行计划。' }),
          expect.objectContaining({ question: '为什么选择这个索引？', answer: null }),
        ],
      }),
    ]);
    expect(result.warnings).toContain('unanswered_questions');
  });

  it('keeps common Q/A text and unclassified notes traceable to the normalized source', () => {
    const result = parsePersonalExperienceText(`公司：云杉网络
岗位：平台工程师

Q1：你如何设计发布流程？
A1：先做灰度发布，
再观察错误率和延迟。

面试官随后追问了回滚策略。`);
    const question = result.experiences[0]?.questions[0];

    expect(question).toMatchObject({
      question: '你如何设计发布流程？',
      answer: '先做灰度发布，\n再观察错误率和延迟。',
    });
    expect(result.experiences[0]?.notes).toBe('面试官随后追问了回滚策略。');
    expect(result.warnings).toContain('unclassified_notes');
    expect(
      result.normalizedText.slice(
        question?.questionEvidence?.start,
        question?.questionEvidence?.end,
      ),
    ).toBe('你如何设计发布流程？');
    expect(
      result.normalizedText.slice(question?.answerEvidence?.start, question?.answerEvidence?.end),
    ).toBe('先做灰度发布，\n再观察错误率和延迟。');
  });

  it('allows a question-less draft but refuses to accept it as history', () => {
    const parsed = parsePersonalExperienceText('公司：示例科技\n岗位：工程师\n过程记录待整理');

    expect(parsed.warnings).toContain('no_questions');
    expect(() => {
      assertExperienceDraftCanBeAccepted(parsed.experiences);
    }).toThrow(DomainError);
  });
});
