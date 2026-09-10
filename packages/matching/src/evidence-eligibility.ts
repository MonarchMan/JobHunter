import type { DeterministicMatchInput, RuleOutcome, RuleStatus } from './model.js';
import { z } from 'zod';
import { evaluateEligibility } from './rules.js';
import { evaluateRecruitmentEligibility, recruitmentCategory } from './recruitment-requirements.js';
import {
  numericRequirement,
  requirementStatements,
  satisfiesNumber,
  type RequirementNode,
} from './requirement-language.js';

/** all/any 使用三值逻辑；缺少一个备选的事实不能把整个或条件误判失败。 */
function combine(values: readonly RuleStatus[], kind: 'all' | 'any'): RuleStatus {
  if (kind === 'all')
    return values.includes('fail') ? 'fail' : values.includes('unknown') ? 'unknown' : 'pass';
  return values.includes('pass') ? 'pass' : values.includes('unknown') ? 'unknown' : 'fail';
}

/** 单条条件使用原始字段证据，数值比较与旧版其他资格能力隔离。 */
function evaluateNode(
  node: RequirementNode,
  input: DeterministicMatchInput,
  experienceContext = false,
): RuleOutcome | null {
  const category = recruitmentCategory(input.job);
  const yearsContext =
    experienceContext ||
    node.path === '/experienceText' ||
    /工作经验|年.*经验|经验.*年/u.test(node.text);
  const qualification =
    /学历|本科|硕士|博士|大专|专科|专业|资格证|证书|在校|在读|应届|届|年.*经验|经验.*年|每周.*天|实习.*月|月.*实习|到岗/u.test(
      node.text,
    ) ||
    (yearsContext && node.text.includes('年')) ||
    node.path === '/educationText' ||
    node.path === '/experienceText';
  if (!qualification) return null;
  // 1. 保留无法确定优先级的复杂条件，不能利用一个可解析子句冒充整句成立。
  let status: RuleStatus = 'unknown';
  let reason = '资格条款未能可靠解释，请确认原文。';
  if (/[()（）]/u.test(node.text)) reason = '括号或嵌套条件的作用范围待确认。';
  else if (node.kind !== 'atom') {
    const children = node.children.map((child) => evaluateNode(child, input, yearsContext));
    const relevant = children.filter((item) => item !== null);
    if (!relevant.length) return null;
    const values =
      node.kind === 'any'
        ? children.map((item) => item?.status ?? 'unknown')
        : relevant.map((item) => item.status);
    status = combine(values, node.kind);
    reason = `${node.kind === 'all' ? '同时满足' : '满足任一'}：${relevant.map((item) => item.explanation).join('；')}`;
  } else if (node.mode !== 'required') {
    status = 'pass';
    reason = node.mode === 'waived' ? '此条件明确豁免，不添加门槛。' : '此条件仅优先，不作硬排除。';
  } else {
    // 2. 年限支持上限/下限；实习可用天数和月数为容量，达到最低需求即可。
    const numeric =
      category === 'social' && yearsContext && /年|经验/u.test(node.text)
        ? { unit: '年' as const, value: input.profile.yearsOfExperience }
        : category === 'internship' && /每周.*天/u.test(node.text)
          ? {
              unit: '天' as const,
              value: input.profile.matchingConstraints?.internshipDaysPerWeek ?? null,
            }
          : category === 'internship' && /实习.*月|月.*实习|持续.*月/u.test(node.text)
            ? {
                unit: '月' as const,
                value: input.profile.matchingConstraints?.internshipMonths ?? null,
              }
            : null;
    if (numeric) {
      const bounds = numericRequirement(node.text, numeric.unit);
      const matches = bounds
        ? satisfiesNumber(
            numeric.value,
            numeric.unit === '年' ? bounds : { ...bounds, maximum: null },
          )
        : null;
      status = matches === null ? 'unknown' : matches ? 'pass' : 'fail';
      reason = `数值条件“${node.text}”；候选事实：${numeric.value === null ? '未知' : String(numeric.value)}${numeric.unit}。`;
    } else if (category === 'internship' && /在校生|在读|在校学生/u.test(node.text)) {
      const student = input.profile.matchingConstraints?.studentStatus;
      status =
        student == null ? 'unknown' : ['student', 'graduating'].includes(student) ? 'pass' : 'fail';
      reason = '比较明确在读身份；年级不限不豁免在读要求。';
    } else if (
      /20\d{2}-\d{2}-\d{2}/u.test(node.text) &&
      node.text.includes('到岗') &&
      !z.iso.date().safeParse(/20\d{2}-\d{2}-\d{2}/u.exec(node.text)?.[0]).success
    ) {
      reason = '到岗日期不是有效日历日期，请确认。';
    } else {
      // 3. 已有学历/届别等判断只接收独立原子，避免局部修饰跨条件传播。
      const isolated = {
        ...input,
        job: {
          ...input.job,
          description: '',
          experienceText: null,
          educationText: null,
          [node.path.slice(1)]:
            /本科|硕士|博士|大专|专科/u.test(node.text) && !node.text.includes('学历')
              ? `${node.text}学历`
              : node.text,
        },
      };
      const outcomes = evaluateRecruitmentEligibility(isolated, category).filter(
        (item) =>
          item.ruleId.startsWith('qualification.') &&
          item.ruleId !== 'qualification.recruitment-category',
      );
      if (outcomes.length) {
        status = combine(
          outcomes.map((item) => item.status),
          'all',
        );
        reason = outcomes.map((item) => item.explanation).join('；');
      }
    }
  }
  return {
    ruleId: 'qualification.condition-v3',
    status,
    explanation: reason.slice(0, 500),
    evidence: [{ source: 'job', path: node.path, summary: node.text.slice(0, 300) }],
  };
}

/** v3 用条件树替换资格检查，用户明确偏好继续使用既有独立规则。 */
export function evaluateEvidenceEligibility(input: DeterministicMatchInput): RuleOutcome[] {
  // 1. 保留地点/类型等偏好，不使用旧版最低年限规则。
  const results = evaluateEligibility(input).filter(
    (item) => item.ruleId !== 'qualification.minimum-experience',
  );
  const category = recruitmentCategory(input.job);
  results.push({
    ruleId: 'qualification.recruitment-category',
    status: category === 'unknown' ? 'unknown' : 'pass',
    evidence: [{ source: 'job', path: '/recruitmentCategory', summary: `招聘类别：${category}` }],
    explanation: '按冻结职位招聘类别选择规则，不使用当前同步渠道。',
  });
  // 2. 同原文同路径去重，保存稳定序号方便详情与建议引用。
  const seen = new Set<string>();
  for (const node of requirementStatements(input.job)) {
    const key = `${node.path}:${node.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const outcome = evaluateNode(node, input);
    if (outcome)
      results.push({ ...outcome, ruleId: `${outcome.ruleId}.${String(results.length)}` });
  }
  return results;
}
