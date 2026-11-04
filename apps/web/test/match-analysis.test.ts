import { expect, it } from 'vitest';
import { objectiveRuleRows, ruleGaps } from '../app/jobs/[id]/match-summary.js';

it('separates role and location display without increasing the qualification weight', () => {
  const rows = objectiveRuleRows(
    [
      { ruleId: 'preference.role', status: 'fail', evidence: [], explanation: '方向不符' },
      { ruleId: 'preference.location', status: 'pass', evidence: [], explanation: '地点符合' },
      {
        ruleId: 'qualification.condition-v3.0',
        status: 'pass',
        evidence: [],
        explanation: '学历符合',
      },
    ],
    true,
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]?.maximumScore).toBeCloseTo(100 / 3);
  expect(rows[0]?.label).toBe('学历符合');
});

it('expands scored rules with concrete labels and excludes category routing (MCH-025)', () => {
  const rows = objectiveRuleRows([
    {
      ruleId: 'qualification.recruitment-category',
      status: 'pass',
      evidence: [],
      explanation: '实习',
    },
    { ruleId: 'preference.location', status: 'pass', evidence: [], explanation: '地点匹配' },
    { ruleId: 'preference.company-size', status: 'fail', evidence: [], explanation: '规模不符' },
    {
      ruleId: 'qualification.condition-v3.2',
      status: 'unknown',
      evidence: [{ source: 'job', path: '/description', summary: '每周至少实习3天' }],
      explanation: '缺少候选人事实',
    },
  ]);
  expect(rows.map((row) => row.label)).toEqual(['地点', '公司规模', '每周至少实习3天']);
  expect(rows.reduce((sum, row) => sum + row.maximumScore, 0)).toBeCloseTo(100);
  expect(rows.map((row) => row.score)).toEqual([100 / 3, 0, 0]);
  expect(objectiveRuleRows([])).toEqual([]);
});

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
