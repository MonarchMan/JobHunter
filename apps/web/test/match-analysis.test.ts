import { expect, it } from 'vitest';
import { ruleGaps } from '../app/jobs/[id]/match-summary.js';

it('deduplicates missing evidence and excludes inapplicable dimensions', () => {
  const base = { score: 0, maximumScore: 35, matchedEvidence: [], uncertainties: [] };
  expect(
    ruleGaps([
      {
        ...base,
        dimension: 'skills',
        missingEvidence: ['未找到正向证据：SQL', '未找到正向证据：RAG'],
      },
      {
        ...base,
        dimension: 'projects',
        missingEvidence: ['未找到正向证据：SQL', '未找到相关职责与贡献证据：数据分析'],
      },
      {
        ...base,
        dimension: 'experience',
        evidenceStatus: 'not_applicable',
        missingEvidence: ['未找到正向证据：Python'],
      },
    ]),
  ).toEqual(['SQL', 'RAG', '数据分析实践']);
});
