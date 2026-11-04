import { expect, it } from 'vitest';
import { jobAdviceSchema, parseStoredJobAdvice } from '../src/contracts/job-advice.js';

it('reads only the current advice contract and rejects legacy fields (WEB-003)', () => {
  const old = {
    highlights: [
      { text: '经验匹配（ref-1）', references: ['ref-1'] },
      { text: '技能匹配', references: [] },
    ],
    gaps: [],
    uncertainties: [{ text: '确认团队', references: [] }],
    preparation: ['准备项目'],
    resumeEmphasis: ['旧重点'],
  };
  expect(() => parseStoredJobAdvice(old)).toThrow();
  const current = { highlights: [{ text: '经验匹配' }], gaps: [], preparation: ['准备项目'] };
  expect(parseStoredJobAdvice(current)).toEqual(current);
  expect(jobAdviceSchema.safeParse(old).success).toBe(false);
  expect(() =>
    parseStoredJobAdvice({ highlights: [{ text: 123 }], gaps: [], preparation: [] }),
  ).toThrow();
});
