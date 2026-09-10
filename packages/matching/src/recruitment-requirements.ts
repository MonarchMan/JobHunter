import type { NormalizedJob } from '@jobhunter/domain';
import type { DeterministicMatchInput, RuleOutcome } from './model.js';
import { evaluateEligibility } from './rules.js';

/** 招聘类别来自冻结职位，unknown 不等同于默认社招。 */
export type RecruitmentCategory = 'social' | 'campus' | 'internship' | 'unknown';

/** 优先使用来源明确声明的类别，旧快照仅接受无歧义的标题/用工类型。 */
export function recruitmentCategory(job: NormalizedJob): RecruitmentCategory {
  // 1. 已有分类为快照事实，不受用户当前同步渠道影响。
  if (job.recruitmentCategory) return job.recruitmentCategory;
  // 2. 全职并不能区分校招和社招；冲突词也不强行选一个类别。
  const text = `${job.title} ${job.employmentType ?? ''}`;
  const matches: RecruitmentCategory[] = [];
  if (/实习|internship|\bintern\b/iu.test(text)) matches.push('internship');
  if (/校招|校园招聘|应届|campus/iu.test(text)) matches.push('campus');
  if (/社招|社会招聘|experienced hire/iu.test(text)) matches.push('social');
  return matches.length === 1 ? (matches[0] ?? 'unknown') : 'unknown';
}

/** 条款保留字段与原文，用于确定性资格检查与评分解释。 */
export interface RequirementClause {
  readonly text: string;
  readonly path: string;
  readonly preferred: boolean;
}

/** 按语义短句拆分要求，优先项不升级为硬门槛。 */
export function requirementClauses(job: NormalizedJob): RequirementClause[] {
  // 1. 不使用标题、公司简介推断资格；保留标准化原文字段路径。
  return (['description', 'experienceText', 'educationText'] as const).flatMap((field) =>
    (job[field] ?? '')
      .split(/[\n；;。，,]/u)
      .map((text) => ({
        text: text.trim(),
        path: `/${field}`,
        preferred: /优先|加分|加分项|更佳|preferred|nice.to.have/iu.test(text),
      }))
      .filter((clause) => clause.text.length > 0),
  );
}

/** 学历只用于显式最低资格，不按学校身份或排名加分。 */
function degreeRank(value: string): number | null {
  if (/博士|ph\.?d/iu.test(value)) return 4;
  if (/硕士|研究生|master/iu.test(value)) return 3;
  if (/本科|学士|bachelor/iu.test(value)) return 2;
  if (/大专|专科|associate/iu.test(value)) return 1;
  return null;
}

/** 将一个显式要求与候选人事实比较；缺失不能判为 fail。 */
function outcome(
  id: string,
  clause: RequirementClause,
  matches: boolean | null,
  detail: string,
): RuleOutcome {
  const status = clause.preferred
    ? 'pass'
    : matches === null
      ? 'unknown'
      : matches
        ? 'pass'
        : 'fail';
  return {
    ruleId: `qualification.${id}`,
    status,
    evidence: [{ source: 'job', path: clause.path, summary: clause.text.slice(0, 300) }],
    explanation: `${clause.preferred ? '优先项，不作硬排除。' : ''}${detail}`,
  };
}

/** 读取明确经验下限；无要求不等于缺失一个必须的资格。 */
export function minimumExperience(job: NormalizedJob): number | null {
  // 1. 只接受工作/经验语境中的年限，排除毕业年份、实习时长与优先项。
  for (const clause of requirementClauses(job)) {
    if (clause.preferred || /不限|无需|不要求/u.test(clause.text)) continue;
    if (clause.path !== '/experienceText' && !/工作|经验/u.test(clause.text)) continue;
    const match =
      /(?:至少|不少于|最低)?\s*(\d+(?:\.\d+)?)\s*(?:[-~～至]\s*\d+)?\s*年(?:以上|及以上|的)?/u.exec(
        clause.text,
      );
    if (match && Number(match[1]) <= 60) return Number(match[1]);
  }
  return null;
}

/** v2 按三类招聘语境检查资格；所有状态携带职位原文。 */
export function evaluateRecruitmentEligibility(
  input: DeterministicMatchInput,
  category: RecruitmentCategory,
): RuleOutcome[] {
  // 1. 地点、用户排除词等显式偏好复用旧规则，移除旧的无条件经验检查。
  const results = evaluateEligibility(input).filter(
    (rule) => rule.ruleId !== 'qualification.minimum-experience',
  );
  results.push({
    ruleId: 'qualification.recruitment-category',
    status: category === 'unknown' ? 'unknown' : 'pass',
    evidence: [{ source: 'job', path: '/recruitmentCategory', summary: `招聘类别：${category}` }],
    explanation:
      category === 'unknown'
        ? '职位招聘类别不明确，暂不套用三类评分。'
        : '按职位自身招聘类别选择资格与权重。',
  });
  const facts = input.profile.matchingConstraints;
  const degrees = input.profile.education
    .map((item) => degreeRank(item.degree ?? ''))
    .filter((value) => value !== null);
  const candidateDegree = degrees.length ? Math.max(...degrees) : null;
  const graduationYear = facts?.graduationYear ?? null;
  // 2. 只检查职位中出现的要求；未识别或相关性有歧义时保留 unknown。
  for (const clause of requirementClauses(input.job)) {
    const text = clause.text;
    const before = results.length;
    if (/学历|本科|硕士|博士|大专|专科/u.test(text) && !/学历不限|不要求学历/u.test(text)) {
      const rank = degreeRank(text);
      if (
        rank !== null &&
        (clause.path === '/educationText' || /要求|需|以上|及以上|学历/u.test(text))
      ) {
        // 2.a. 多学历选项用最低门槛，避免“本科/硕士”被错误升级到硕士。
        const ranks = [...text.matchAll(/博士|硕士|研究生|本科|学士|大专|专科/gu)].map(
          (match) => degreeRank(match[0]) ?? 0,
        );
        const minimum = Math.min(...ranks);
        results.push(
          outcome(
            'education',
            clause,
            candidateDegree === null ? null : candidateDegree >= minimum,
            candidateDegree === null
              ? '候选人学历待确认。'
              : '按明确学历要求比较，不使用院校排名。',
          ),
        );
      }
    }
    const major = /([\p{Script=Han}A-Za-z]+)(?:及相关|相关)?专业/u.exec(text)?.[1];
    if (major && /要求|需|限定|仅限|相关专业/u.test(text)) {
      const fields = input.profile.education.flatMap((item) => (item.field ? [item.field] : []));
      const cleaned = major.replace(/^(?:要求|需|限定|仅限)/u, '').replace(/(?:及相关|相关)$/u, '');
      const matches = fields.some((field) => field.includes(cleaned) || cleaned.includes(field));
      results.push(
        outcome(
          'major',
          clause,
          matches ? true : null,
          matches ? '专业名称有明确对应。' : '专业相关性无法由文本可靠判定，请确认。',
        ),
      );
    }
    const certificate =
      /(?:必须|要求|需)(?:持有|具备|取得|通过)([^，,；;。]+?(?:证书|资格证|资格考试))/u.exec(
        text,
      )?.[1];
    if (certificate) {
      const matches = input.profile.certificates.some(
        (item) => item.name.includes(certificate) || certificate.includes(item.name),
      );
      results.push(
        outcome(
          'certificate',
          clause,
          matches ? true : null,
          matches ? '画像包含要求的资质。' : '简历未确认该资质，不据缺失直接排除。',
        ),
      );
    }
    if (category === 'social') {
      const minimum = minimumExperience({
        ...input.job,
        description: '',
        educationText: null,
        experienceText: text,
      });
      if (minimum !== null && (clause.path === '/experienceText' || /工作|经验/u.test(text))) {
        const years = input.profile.yearsOfExperience;
        results.push(
          outcome(
            'minimum-experience',
            clause,
            years === null ? null : years >= minimum,
            years === null
              ? '相关工作年限待确认。'
              : `候选人 ${String(years)} 年，要求至少 ${String(minimum)} 年。`,
          ),
        );
      }
    }
    if (category === 'campus') {
      const yearList = /((?:20\d{2}\s*[、/]\s*)+20\d{2})\s*届/u.exec(text)?.[1];
      const allowedYears = yearList
        ? [...yearList.matchAll(/20\d{2}/gu)].map((item) => Number(item[0]))
        : null;
      const yearMatch = /(20\d{2})(?:\s*[-~～至]\s*(20\d{2}))?\s*届/u.exec(text);
      if (yearMatch) {
        const first = Number(yearMatch[1]);
        const last = Number(yearMatch[2] ?? yearMatch[1]);
        results.push(
          outcome(
            'graduation-year',
            clause,
            graduationYear === null
              ? null
              : allowedYears
                ? allowedYears.includes(graduationYear)
                : graduationYear >= first && graduationYear <= last,
            graduationYear === null
              ? '请确认毕业届别。'
              : `候选人毕业届别：${String(graduationYear)}。`,
          ),
        );
      }
      if (/应届(?:毕业生|生)|应届身份/u.test(text) && !/不限|无需|不要求/u.test(text)) {
        results.push(
          outcome(
            'graduate-status',
            clause,
            facts?.studentStatus == null
              ? null
              : ['graduating', 'fresh_graduate'].includes(facts.studentStatus),
            '以用户确认的应届身份比较，不用当前日期推断。',
          ),
        );
      }
    }
    if (category === 'internship') {
      if (/在校生|在读|在校学生/u.test(text) && !/不限|无需|不要求/u.test(text)) {
        results.push(
          outcome(
            'student-status',
            clause,
            facts?.studentStatus == null
              ? null
              : ['student', 'graduating'].includes(facts.studentStatus),
            '实习在读身份要求。',
          ),
        );
      }
      const days = /每周(?:至少|不少于|需|到岗|出勤|实习|保证|工作|\s)*(\d)\s*天/u.exec(text);
      if (days)
        results.push(
          outcome(
            'internship-days',
            clause,
            facts?.internshipDaysPerWeek == null
              ? null
              : facts.internshipDaysPerWeek >= Number(days[1]),
            '比较每周可到岗天数。',
          ),
        );
      const months =
        /(?:实习|持续)(?:期|时间|时长)?(?:至少|不少于|满|为|需|\s)*(\d+(?:\.\d+)?)\s*个?月/u.exec(
          text,
        );
      if (months)
        results.push(
          outcome(
            'internship-months',
            clause,
            facts?.internshipMonths == null ? null : facts.internshipMonths >= Number(months[1]),
            '比较可持续实习月数。',
          ),
        );
      const date = /(20\d{2}-\d{2}-\d{2})\s*(?:之前|前)(?:到岗|入职)/u.exec(text)?.[1];
      if (date)
        results.push(
          outcome(
            'available-from',
            clause,
            facts?.availableFrom == null ? null : facts.availableFrom <= date,
            '比较明确的最晚到岗日期。',
          ),
        );
      if (/尽快到岗|长期实习|每周.{0,12}[一二三四五六七]天/u.test(text))
        results.push(
          outcome('availability-unclear', clause, null, '时间要求未能可靠量化，请确认。'),
        );
    }
    // 2.b. 中文数字、模糊年限等资格条款无法量化时必须保留待确认，不静默通过。
    const unresolved =
      /学历|专业|资格证|证书/u.test(text) ||
      (category === 'social' && /(?:年.*经验|经验.*年)/u.test(text)) ||
      (category === 'campus' && /届|应届/u.test(text)) ||
      (category === 'internship' && /在读|在校|每周.*天|实习.*月|到岗/u.test(text));
    if (results.length === before && unresolved && !/不限|无需|不要求/u.test(text)) {
      results.push(outcome('unparsed', clause, null, '资格条款未能可靠解释，请结合原文确认。'));
    }
  }
  // 3. 同一规则多条要求保留各条证据，仅去除完全重复的条款。
  return results.filter(
    (rule, index) =>
      results.findIndex((other) => JSON.stringify(other) === JSON.stringify(rule)) === index,
  );
}
