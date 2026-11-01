import type { NormalizedJob } from './normalized-job.js';

/** 职位一级分类枚举。 */
export const canonicalJobFamilies = [
  '研发',
  '产品',
  '设计',
  '运营',
  '销售',
  '职能',
  '市场',
  '数据',
  '测试',
  '其他',
] as const;

export type CanonicalJobFamily = (typeof canonicalJobFamilies)[number];

/** 职位二级分类枚举。 */
export const canonicalJobSubfamilies = [
  '后端',
  '前端',
  '算法',
  '客户端',
  '测试',
  '数据分析',
  '产品经理',
  '交互设计',
  '视觉设计',
] as const;

export type CanonicalJobSubfamily = (typeof canonicalJobSubfamilies)[number];

/** 模块数据结构或契约。 */
export interface JobTaxonomy {
  readonly jobFamily: CanonicalJobFamily;
  readonly jobSubfamily: CanonicalJobSubfamily | null;
}

const familyRules: readonly [CanonicalJobFamily, readonly string[]][] = [
  [
    '研发',
    [
      '研发',
      '技术',
      '算法',
      '后端',
      '服务端',
      '前端',
      '客户端',
      '软件开发',
      '开发工程',
      '工程师',
      '人工智能',
      '大模型',
      '架构',
      '嵌入式',
      '引擎',
      '机器学习',
      '安全',
    ],
  ],
  ['产品', ['产品']],
  ['设计', ['设计', '交互', '视觉', '用户体验', 'ux', 'ui']],
  ['运营', ['运营', '内容', '增长']],
  ['销售', ['销售', '商务', '客户成功', '拓展', '采销']],
  ['数据', ['数据', '数据分析', '数据科学', 'bi', '商业分析']],
  ['测试', ['测试', '质量', 'qa']],
  ['职能', ['人力', '招聘', '财务', '法务', '行政', '采购', 'hr']],
  ['市场', ['市场', '公关', '品牌', '营销']],
];

const subfamilyRules: readonly [CanonicalJobSubfamily, readonly string[]][] = [
  ['产品经理', ['产品经理', '产品策划']],
  ['后端', ['后端', '服务端', 'server']],
  ['前端', ['前端', 'web前端', 'frontend']],
  ['算法', ['算法', '人工智能', '机器学习', '深度学习', '大模型', '模型', 'nlp', '推荐', 'agent']],
  ['客户端', ['客户端', '移动端', 'ios', 'android']],
  ['测试', ['测试', 'qa', '质量']],
  ['数据分析', ['数据分析', '商业分析', 'bi']],
  ['交互设计', ['交互设计', '用户体验', 'ux']],
  ['视觉设计', ['视觉设计', '视觉实习生', 'ui', '用户界面']],
];

/** 根据标题或部门关键词归一化职位分类。 */
export function normalizeJobTaxonomy(value: string | null | undefined): JobTaxonomy {
  const text = value?.trim();
  if (!text) return { jobFamily: '其他', jobSubfamily: null };
  const haystack = text.toLocaleLowerCase();
  const family =
    familyRules.find(([, terms]) =>
      terms.some((term) => haystack.includes(term.toLocaleLowerCase())),
    )?.[0] ?? '其他';
  const jobSubfamily =
    subfamilyRules.find(([, terms]) =>
      terms.some((term) => haystack.includes(term.toLocaleLowerCase())),
    )?.[0] ?? null;
  return { jobFamily: family, jobSubfamily };
}

/** 合并职位多个分类字段后计算最终分类。 */
export function canonicalizeJobTaxonomy(
  job: Pick<NormalizedJob, 'title' | 'department' | 'jobFamily' | 'jobSubfamily'>,
): JobTaxonomy {
  return normalizeJobTaxonomy(
    [job.title, job.department, job.jobFamily, job.jobSubfamily].filter(Boolean).join(' '),
  );
}
