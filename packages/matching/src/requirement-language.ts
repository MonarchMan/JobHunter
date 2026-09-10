import type { NormalizedJob } from '@jobhunter/domain';

/** 条件树保存原文与逻辑关系；未实现完整自然语言语法，歧义由消费者保留未知。 */
export type RequirementNode =
  | {
      readonly kind: 'all' | 'any';
      readonly children: readonly RequirementNode[];
      readonly text: string;
      readonly path: string;
    }
  | {
      readonly kind: 'atom';
      readonly text: string;
      readonly path: string;
      readonly mode: 'required' | 'preferred' | 'waived';
    };

/** 只拆分有明确作用范围的连接词，不拆开“设计并实现”等动作。 */
export function parseRequirement(text: string, path: string): RequirementNode {
  // 1. 先分合取，再分备选；混合括号不猜测优先级，由资格消费者标记未知。
  if (/优先|加分/u.test(text)) {
    const scoped = text.split(/[，,]|(?:和|与)(?=[^，,；;]+(?:优先|加分))/u);
    if (scoped.length > 1)
      return {
        kind: 'all',
        children: scoped.map((part) => parseRequirement(part.trim(), path)),
        text,
        path,
      };
  }
  const all = text
    .split(
      /并且|而且|且|同时|但是|但|[，,](?=\s*(?:必须|要求|需|每周|至少|最多|实习至少|学历|在校|应届|年级|专业|具备|熟悉|掌握|有|不要求|无需))/u,
    )
    .map((part) => part.trim())
    .filter(Boolean);
  if (all.length > 1)
    return { kind: 'all', children: all.map((part) => parseRequirement(part, path)), text, path };
  const any = text
    .split(/或者|或|\bor\b/iu)
    .map((part) => part.trim())
    .filter(Boolean);
  // 2. 技能的“任选”组也保留 any 关系，后续评分不把每个备选当独立要求。
  if (any.length > 1)
    return { kind: 'any', children: any.map((part) => parseRequirement(part, path)), text, path };
  return {
    kind: 'atom',
    text,
    path,
    mode: /无需|不要求|不必|无.{0,4}要求|(?:经验|学历|学籍|身份|届别|专业|天数|时长)不限|不限(?:经验|学历|学籍|身份|届别|专业|天数|时长)/u.test(
      text,
    )
      ? 'waived'
      : /优先|加分|更佳|preferred|nice.to.have/iu.test(text)
        ? 'preferred'
        : 'required',
  };
}

/** 原文按段落保留来源；公司介绍等明确非要求章节不进入匹配。 */
export function requirementStatements(job: NormalizedJob): RequirementNode[] {
  // 1. 默认接受没有章节标题的职位正文；只有明确介绍标题才停止读取该章节。
  const result: RequirementNode[] = [];
  for (const field of ['description', 'experienceText', 'educationText'] as const) {
    let ignored = false;
    for (const line of (job[field] ?? '').split(/\r?\n/u)) {
      if (/^\s*(?:公司介绍|关于我们|团队介绍|福利待遇)\s*[:：]?/u.test(line)) {
        ignored = true;
        continue;
      }
      if (/^\s*(?:任职要求|岗位要求|职位要求|岗位职责|工作职责|职责描述)\s*[:：]?/u.test(line))
        ignored = false;
      if (ignored) continue;
      for (const text of line
        .split(/[；;。]/u)
        .map((part) => part.trim())
        .filter(Boolean))
        result.push(parseRequirement(text, `/${field}`));
    }
  }
  return result;
}

/** 常用中文数字转为比较值；不改动对外保存的原文证据。 */
export function numericText(text: string): string {
  const digits: Readonly<Record<string, number>> = {
    零: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  return text.replaceAll(/[零一二两三四五六七八九十]+/gu, (value) => {
    const [tens, units] = value.split('十');
    return String(
      value.includes('十')
        ? (tens ? (digits[tens] ?? 0) : 1) * 10 + (units ? (digits[units] ?? 0) : 0)
        : (digits[value] ?? value),
    );
  });
}

/** 数值要求包含闭开边界，经验区间不得退化成仅下限。 */
export interface NumericRequirement {
  readonly minimum: number | null;
  readonly maximum: number | null;
  readonly minimumInclusive: boolean;
  readonly maximumInclusive: boolean;
}

/** 从明确单位附近识别比较规则，缺失比较词时沿用最低要求语义。 */
export function numericRequirement(
  text: string,
  unit: '年' | '天' | '月',
): NumericRequirement | null {
  // 1. 只读取带目标单位的值，排除毕业年份及不合理的大数。
  const value = numericText(text);
  const match = new RegExp(
    `(\\d+(?:\\.\\d+)?)(?:\\s*[-~～至到]\\s*(\\d+(?:\\.\\d+)?))?\\s*个?${unit}`,
    'u',
  ).exec(value);
  if (!match) return null;
  const first = Number(match[1]);
  const last = match[2] === undefined ? null : Number(match[2]);
  if (first > 60 || (last !== null && (last > 60 || last < first))) return null;
  // 2. 上下文紧邻数值，避免别的条件中的“至少”改变当前比较方向。
  const before = value.slice(0, match.index);
  const after = value.slice(match.index + match[0].length);
  if (last !== null)
    return { minimum: first, maximum: last, minimumInclusive: true, maximumInclusive: true };
  const upper =
    /最多|不超过|不高于|不大于|不满|(?<!不)少于|(?<!不)低于/u.test(before) ||
    /^(?:及)?以下|^以内/u.test(after);
  return {
    minimum: upper ? null : first,
    maximum: upper ? first : null,
    minimumInclusive: !/(?<!不)超过|(?<!不)多于|(?<!不)大于/u.test(before),
    maximumInclusive: !/不满|(?<!不)少于|(?<!不)低于/u.test(before),
  };
}

/** 比较冻结事实，不读取系统时间，也不把未知当作零。 */
export function satisfiesNumber(
  value: number | null,
  requirement: NumericRequirement,
): boolean | null {
  if (value === null) return null;
  return (
    (requirement.minimum === null ||
      (requirement.minimumInclusive
        ? value >= requirement.minimum
        : value > requirement.minimum)) &&
    (requirement.maximum === null ||
      (requirement.maximumInclusive ? value <= requirement.maximum : value < requirement.maximum))
  );
}

/** 全句否定/计划作用于后续技能或动作，分句后不泄漏到相邻的正向事实。 */
export function isNonEvidence(text: string): boolean {
  return /尚未|还未|未曾|没有|不熟悉|不掌握|未掌握|未学过|不会|不具备|未使用|未参与|未负责|未完成|未上线|未验证|未接触|无.{0,12}经验|计划|打算|准备学习|希望学习|正在学习|自学|学习中/u.test(
    text,
  );
}
