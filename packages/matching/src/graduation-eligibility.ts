import { z } from 'zod';
import type { DeterministicMatchInput, RuleOutcome, RuleStatus } from './model.js';
import type { RequirementNode } from './requirement-language.js';

/** 严格日期转换为月份序号；部分年份与非法日期不伪装成完整毕业月份。 */
function monthValue(value: string | null): number | null {
  if (!value) return null;
  const normalized = value.replace(/年/u, '-').replace(/月$/u, '');
  const match = /^(20\d{2})-(\d{1,2})(?:-(\d{2}))?$/u.exec(normalized);
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  if (match[3] && !z.iso.date().safeParse(normalized).success) return null;
  return Number(match[1]) * 12 + month - 1;
}

/** 毕业片段单独求值，并交回剩余原文以继续校验学历和在读等资格。 */
export function graduationCondition(
  node: RequirementNode,
  input: DeterministicMatchInput,
): { outcome: RuleOutcome; remainder: string } | null {
  if (!/届|毕业/u.test(node.text)) return null;
  // 1. 只识别明确的月份窗口或届别表达；窗口解释同句届别而不是重复按自然年限制。
  const window =
    /(?:20\d{2})[年-]\d{1,2}月?\s*[-~～至到]\s*(?:20\d{2})[年-]\d{1,2}月?(?:期间)?毕业/u.exec(
      node.text,
    );
  const cohort = /(?:20)?\d{2}届?(?:\s*(?:[、,，/]|至|到|[-~～])\s*(?:20)?\d{2}届?)*届/u.exec(
    node.text,
  );
  if (!window && !cohort) return null;
  const unexplainedParentheses = /[（(）)]/u.test(
    node.text.replace(window?.[0] ?? '\u0000', '').replace(/[（(]\s*[）)]/gu, ''),
  );
  let status: RuleStatus = 'unknown';
  let explanation = '毕业条件或适用教育经历不明确，请确认。';
  const dates = input.profile.education.map((item) => monthValue(item.endDate));
  let values: (boolean | null)[] = [];
  // 2. 优先与豁免不构成门槛；不支持的逻辑与非封闭列举不能推导硬排除。
  if (node.kind === 'atom' && node.mode !== 'required') {
    status = 'pass';
    explanation = '毕业条件仅优先或已豁免，不作硬排除。';
  } else if (
    !unexplainedParentheses &&
    !/或者|或|均可|等届|不限|除外|不含|不包括|非\d|届及?(?:以|之)?[前后]/u.test(node.text)
  ) {
    if (window) {
      const bounds = [...window[0].matchAll(/(20\d{2})[年-](\d{1,2})月?/gu)].map((item) =>
        monthValue(`${String(item[1])}-${String(item[2])}`),
      );
      const [start, end] = bounds;
      if (start != null && end != null && start <= end)
        values = dates.map((date) => (date === null ? null : date >= start && date <= end));
    } else if (cohort) {
      const years = [...cohort[0].matchAll(/(?:20)?\d{2}/gu)].map((item) =>
        Number(item[0].length === 2 ? `20${item[0]}` : item[0]),
      );
      const range = /至|到|[-~～]/u.test(cohort[0]);
      const first = years[0];
      const last = years.at(-1);
      const explicit = input.profile.matchingConstraints?.graduationYear;
      const candidates =
        explicit != null
          ? [explicit]
          : dates.map((date) => (date === null ? null : Math.floor(date / 12)));
      if (
        first !== undefined &&
        last !== undefined &&
        (!range || (years.length === 2 && first <= last && !/[、,，/]/u.test(cohort[0])))
      )
        values = candidates.map((year) =>
          year === null ? null : range ? year >= first && year <= last : years.includes(year),
        );
    }
    // 3. 所有可能经历一致才给确定结论；缺少任一日期或命中与冲突混合保持未知。
    if (values.length && values.every((value) => value === true)) status = 'pass';
    else if (values.length && values.every((value) => value === false)) status = 'fail';
    explanation = `毕业${window ? '月份窗口' : '届别'}比较：${status === 'pass' ? '候选日期全部符合' : status === 'fail' ? '候选日期全部明确冲突' : '日期缺失、条件无效或多段教育结论不一致'}。`;
  }
  let remainder = node.text;
  if (window) remainder = remainder.replace(window[0], '');
  if (cohort) remainder = remainder.replace(cohort[0], '');
  remainder = remainder.replace(/[（(]\s*[）)]/gu, '');
  return {
    remainder,
    outcome: {
      ruleId: 'qualification.graduation-v3.2',
      status,
      explanation,
      evidence: [
        { source: 'job', path: node.path, summary: node.text.slice(0, 300) },
        ...input.profile.education.map((item, index) => ({
          source: 'profile' as const,
          path: `/education/${String(index)}/endDate`,
          summary: (item.endDate ?? '毕业日期未知').slice(0, 300),
        })),
        ...(input.profile.matchingConstraints?.graduationYear != null
          ? [
              {
                source: 'profile' as const,
                path: '/matchingConstraints/graduationYear',
                summary: String(input.profile.matchingConstraints.graduationYear),
              },
            ]
          : []),
      ],
    },
  };
}
