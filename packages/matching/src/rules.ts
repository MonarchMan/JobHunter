import type { DeterministicMatchInput, MatchingEvidence, RuleOutcome } from './model.js';

/** 统一规则比较文本的大小写与空白。 */
function normalized(value: string): string {
  return value.toLocaleLowerCase().replaceAll(/[\s\p{P}\p{S}]+/gu, '');
}

/** 为规则结果生成可追溯证据对象。 */
function evidence(
  source: MatchingEvidence['source'],
  path: string,
  summary: string,
): MatchingEvidence {
  return { source, path, summary };
}

/** 执行模块的解析、转换、评分或调用辅助逻辑。 */
function excludedTerms(input: DeterministicMatchInput): RuleOutcome {
  const haystack = normalized(`${input.job.title}\n${input.job.description}`);
  const matched = input.profile.preferences.excludedTerms.filter((term) =>
    haystack.includes(normalized(term)),
  );
  return {
    ruleId: 'preference.excluded-terms',
    status: matched.length > 0 ? 'fail' : 'pass',
    evidence: matched.map((term) =>
      evidence('preference', '/preferences/excludedTerms', `职位命中排除词：${term}`),
    ),
    explanation: matched.length > 0 ? '职位包含用户明确排除的内容。' : '未命中排除词。',
  };
}

function location(input: DeterministicMatchInput): RuleOutcome {
  const preferred = input.profile.preferences.locations;
  if (preferred.length === 0) {
    return {
      ruleId: 'preference.location',
      status: 'pass',
      evidence: [evidence('preference', '/preferences/locations', '未设置地点限制。')],
      explanation: '未设置地点限制。',
    };
  }
  if (input.job.locations.length === 0) {
    return {
      ruleId: 'preference.location',
      status: 'unknown',
      evidence: [evidence('job', '/locations', '职位未提供地点。')],
      explanation: '缺少职位地点，不能判定冲突。',
    };
  }
  const matches = preferred.filter((preference) =>
    input.job.locations.some((jobLocation) => {
      const left = normalized(preference);
      const right = normalized(jobLocation);
      return left.includes(right) || right.includes(left);
    }),
  );
  return {
    ruleId: 'preference.location',
    status: matches.length > 0 ? 'pass' : 'fail',
    evidence: [
      evidence('preference', '/preferences/locations', `目标地点：${preferred.join('、')}`),
      evidence('job', '/locations', `职位地点：${input.job.locations.join('、')}`),
    ],
    explanation: matches.length > 0 ? '职位地点符合偏好。' : '职位地点与明确偏好冲突。',
  };
}

function companySize(input: DeterministicMatchInput): RuleOutcome {
  const preferred = input.profile.preferences.companySizes;
  if (preferred.length === 0) {
    return {
      ruleId: 'preference.company-size',
      status: 'pass',
      evidence: [],
      explanation: '未设置公司规模限制。',
    };
  }
  if (input.company.sizeCategory === null) {
    return {
      ruleId: 'preference.company-size',
      status: 'unknown',
      evidence: [evidence('company', '/sizeCategory', '公司规模未知。')],
      explanation: '缺少公司规模，不能判定冲突。',
    };
  }
  const matches = preferred.includes(input.company.sizeCategory);
  return {
    ruleId: 'preference.company-size',
    status: matches ? 'pass' : 'fail',
    evidence: [
      evidence('preference', '/preferences/companySizes', `目标规模：${preferred.join('、')}`),
      evidence('company', '/sizeCategory', `公司规模：${input.company.sizeCategory}`),
    ],
    explanation: matches ? '公司规模符合偏好。' : '公司规模与明确偏好冲突。',
  };
}

function employmentType(input: DeterministicMatchInput): RuleOutcome {
  const preferred = input.profile.preferences.employmentTypes;
  if (preferred.length === 0) {
    return {
      ruleId: 'preference.employment-type',
      status: 'pass',
      evidence: [],
      explanation: '未设置用工类型限制。',
    };
  }
  if (input.job.employmentType === null) {
    return {
      ruleId: 'preference.employment-type',
      status: 'unknown',
      evidence: [evidence('job', '/employmentType', '职位未提供用工类型。')],
      explanation: '缺少用工类型，不能判定冲突。',
    };
  }
  const jobType = normalized(input.job.employmentType);
  const matches = preferred.some((value) => {
    const preference = normalized(value);
    return preference.includes(jobType) || jobType.includes(preference);
  });
  return {
    ruleId: 'preference.employment-type',
    status: matches ? 'pass' : 'fail',
    evidence: [
      evidence('preference', '/preferences/employmentTypes', `目标类型：${preferred.join('、')}`),
      evidence('job', '/employmentType', `职位类型：${input.job.employmentType}`),
    ],
    explanation: matches ? '用工类型符合偏好。' : '用工类型与明确偏好冲突。',
  };
}

function experience(input: DeterministicMatchInput): RuleOutcome {
  const minimum = input.understanding?.minimumYearsExperience;
  if (!minimum) {
    return {
      ruleId: 'qualification.minimum-experience',
      status: 'unknown',
      evidence: [evidence('job', '/experienceText', '未取得明确最低年限。')],
      explanation: '职位经验年限不明确，不作硬排除。',
    };
  }
  if (input.profile.yearsOfExperience === null) {
    return {
      ruleId: 'qualification.minimum-experience',
      status: 'unknown',
      evidence: [evidence('profile', '/yearsOfExperience', '候选人年限未知。')],
      explanation: '候选人经验年限未知，不作硬排除。',
    };
  }
  const matches = input.profile.yearsOfExperience >= minimum.value;
  return {
    ruleId: 'qualification.minimum-experience',
    status: matches ? 'pass' : 'fail',
    evidence: [
      evidence(
        'profile',
        '/yearsOfExperience',
        `候选人经验：${String(input.profile.yearsOfExperience)} 年`,
      ),
      evidence(
        'enrichment',
        '/minimumYearsExperience',
        `职位最低经验：${String(minimum.value)} 年`,
      ),
    ],
    explanation: matches ? '经验年限满足要求。' : '明确经验年限不足。',
  };
}

/** 按规则集顺序评估职位是否满足硬性资格条件。 */
export function evaluateEligibility(input: DeterministicMatchInput): readonly RuleOutcome[] {
  // 1、评估排除词；2、评估地点/公司/雇佣类型；3、评估经验；4、返回稳定规则结果。
  return [
    excludedTerms(input),
    location(input),
    companySize(input),
    employmentType(input),
    experience(input),
  ];
}
