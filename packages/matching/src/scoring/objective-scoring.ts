import type { DeterministicMatchInput, DeterministicMatchOutput } from '../model.js';
import { evaluateEvidenceEligibility } from './evidence-eligibility.js';
import { recruitmentCategory } from './recruitment-requirements.js';

/** 比较明确资格和偏好，供当前评分统一汇总。 */
export function calculateObjectiveMatch(input: DeterministicMatchInput): DeterministicMatchOutput {
  // 1、解析客观资格，未设置的偏好不增加分母，招聘类别只用于资格路由。
  const preferences = input.profile.preferences;
  const enabled: Readonly<Record<string, boolean>> = {
    'preference.location': preferences.locations.length > 0,
    'preference.company-size': preferences.companySizes.length > 0,
    'preference.employment-type': preferences.employmentTypes.length > 0,
    'preference.excluded-terms': preferences.excludedTerms.length > 0,
  };
  const outcomes = evaluateEvidenceEligibility(input).filter(
    (item) => enabled[item.ruleId] !== false,
  );
  const conditions = outcomes.filter(
    (item) => item.ruleId !== 'qualification.recruitment-category',
  );
  const passed = conditions.filter((item) => item.status === 'pass');
  const failed = conditions.filter((item) => item.status === 'fail');
  const unknown = conditions.filter((item) => item.status === 'unknown');
  // 2、分数表示已确认满足比例；未知占比可见，不硬排除，也不猜测中性能力分。
  const totalScore = conditions.length
    ? Math.round((passed.length / conditions.length) * 10000) / 100
    : 100;
  const evidenceCoverage = conditions.length
    ? Math.round(((conditions.length - unknown.length) / conditions.length) * 100)
    : 100;
  return {
    filterStatus: outcomes.some((item) => item.status === 'fail')
      ? 'excluded'
      : outcomes.some((item) => item.status === 'unknown')
        ? 'uncertain'
        : 'eligible',
    ruleOutcomes: outcomes,
    totalScore,
    components: [
      {
        dimension: 'qualification',
        score: totalScore,
        maximumScore: 100,
        evidenceStatus: unknown.length ? 'unknown' : 'known',
        evidenceCoverage,
        recruitmentCategory: recruitmentCategory(input.job),
        matchedEvidence: passed.flatMap((item) => item.evidence),
        missingEvidence: failed.map((item) => item.explanation),
        uncertainties: unknown.map((item) => item.explanation),
      },
    ],
  };
}
