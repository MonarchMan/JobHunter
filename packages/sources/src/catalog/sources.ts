/** 来源适配器使用的类型约束。 */
export type SourceSupportStatus = 'experimental' | 'supported' | 'blocked';
/** 来源适配器使用的类型约束。 */
export type SourceChannel = 'intern' | 'campus' | 'social';

/** 来源适配器使用的类型约束。 */
export type SourceCoverageRole = 'required' | 'supplemental';

/** 来源适配器使用的数据结构或契约。 */
export interface FirstPartyPhysicalSourceSeed {
  readonly id: string;
  readonly slug: string;
  readonly adapterKey: string;
  readonly recruitmentType: 'social' | 'campus' | 'mixed';
  readonly baseUrl: string;
  readonly config: Readonly<Record<string, unknown>>;
  readonly enabledByDefault: boolean;
  readonly supportStatus: SourceSupportStatus;
  readonly supportNote: string | null;
  readonly coverageRole: SourceCoverageRole;
  readonly defaultRateLimit: {
    readonly requestsPerMinute: number;
    readonly burst: number;
  };
}

/** 执行来源数据的解析、转换、请求或分页逻辑。 */
export interface FirstPartySourceChannelSeed {
  readonly company: {
    readonly id: string;
    readonly slug: string;
    readonly name: string;
    readonly aliases: readonly string[];
    readonly industry: string | null;
    readonly sizeTag: 'large' | 'medium' | 'other';
  };
  readonly channel: {
    readonly id: string;
    readonly slug: string;
    readonly type: SourceChannel;
    readonly enabledByDefault: boolean;
    readonly supportNote: string | null;
  };
  readonly sources: readonly FirstPartyPhysicalSourceSeed[];
}

/** 执行来源数据的解析、转换、请求或分页逻辑。 */
export interface FirstPartySourceSeed {
  readonly company: FirstPartySourceChannelSeed['company'];
  readonly channel: FirstPartySourceChannelSeed['channel'];
  readonly source: FirstPartyPhysicalSourceSeed;
}

/** 执行来源数据的解析、转换、请求或分页逻辑。 */
interface CatalogInput {
  readonly companyId: string;
  readonly sourceId: string;
  readonly slug: string;
  /** Keeps the stable source selector when the supported channel broadens. */
  readonly sourceSlug?: string;
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly sizeTag: 'large' | 'medium';
  readonly entry: string;
  readonly adapterKey: string;
  readonly channel: SourceChannel;
  readonly recruitmentType: 'social' | 'campus' | 'mixed';
  readonly supportStatus: SourceSupportStatus;
  readonly supportNote: string | null;
  readonly config?: Readonly<Record<string, unknown>>;
  readonly requestsPerMinute?: number;
  readonly coverageRole?: SourceCoverageRole;
}

const inputs: readonly CatalogInput[] = [
  {
    companyId: '018f0000-0000-7000-8000-000000000101',
    sourceId: '018f0000-0000-7000-8000-000000000201',
    slug: 'tencent',
    sourceSlug: 'tencent-social',
    name: '腾讯',
    aliases: ['Tencent'],
    sizeTag: 'large',
    entry: 'https://careers.tencent.com/search.html',
    adapterKey: 'tencent.social',
    channel: 'social',
    recruitmentType: 'social',
    supportStatus: 'supported',
    supportNote: '公开匿名 JSON 列表与详情协议已于 2026-08-20 通过门禁。',
    config: { pageSize: 100 },
  },
  {
    companyId: '018f0000-0000-7000-8000-000000000102',
    sourceId: '018f0000-0000-7000-8000-000000000202',
    slug: 'alibaba',
    name: '阿里巴巴',
    aliases: ['Alibaba'],
    sizeTag: 'large',
    entry: 'https://campus-talent.alibaba.com/campus/position?batchId=100000560002',
    adapterKey: 'alibaba.campus',
    channel: 'campus',
    recruitmentType: 'campus',
    supportStatus: 'supported',
    supportNote:
      '匿名浏览器由官网自身脚本生成运行时请求；339 条职位、34 页分页、稳定 ID 和字段归一化已通过 Smoke。',
  },
  {
    companyId: '018f0000-0000-7000-8000-000000000101',
    sourceId: '018f0000-0000-7000-8000-000000000211',
    slug: 'tencent',
    sourceSlug: 'tencent-intern',
    name: '腾讯',
    aliases: ['Tencent'],
    sizeTag: 'large',
    entry: 'https://join.qq.com/post.html',
    adapterKey: 'tencent.intern',
    channel: 'intern',
    recruitmentType: 'campus',
    supportStatus: 'supported',
    supportNote:
      '校园官网匿名 JSON 协议按应届实习、日常实习及青云实习项目筛选；列表 count/pageIndex/pageSize 与详情响应已于 2026-08-23 验证。',
    config: { pageSize: 100 },
  },
  {
    companyId: '018f0000-0000-7000-8000-000000000103',
    sourceId: '018f0000-0000-7000-8000-000000000203',
    slug: 'baidu',
    name: '百度',
    aliases: ['Baidu'],
    sizeTag: 'large',
    entry: 'https://talent.baidu.com/jobs/list?recruitType=INTERN',
    adapterKey: 'baidu.campus',
    channel: 'campus',
    recruitmentType: 'campus',
    supportStatus: 'supported',
    supportNote:
      '匿名校园 JSON 接口按实习优先采集；617 条职位、31 页分页、稳定 ID 和字段归一化已通过 Smoke。',
  },
  {
    companyId: '018f0000-0000-7000-8000-000000000104',
    sourceId: '018f0000-0000-7000-8000-000000000204',
    slug: 'bytedance',
    name: '字节跳动',
    aliases: ['ByteDance'],
    sizeTag: 'large',
    entry: 'https://jobs.bytedance.com/experienced/position',
    adapterKey: 'bytedance.social',
    channel: 'social',
    recruitmentType: 'social',
    supportStatus: 'supported',
    supportNote:
      '匿名浏览器由官网自身脚本生成动态签名；列表响应的 count/limit/offset 分页、稳定 ID、官方详情 URL 和字段归一化已通过 Smoke。',
  },
  {
    companyId: '018f0000-0000-7000-8000-000000000104',
    sourceId: '018f0000-0000-7000-8000-000000000213',
    slug: 'bytedance',
    sourceSlug: 'bytedance-campus',
    name: '字节跳动',
    aliases: ['ByteDance'],
    sizeTag: 'large',
    entry: 'https://jobs.bytedance.com/campus/position',
    adapterKey: 'bytedance.campus',
    channel: 'campus',
    recruitmentType: 'campus',
    supportStatus: 'supported',
    supportNote:
      '正常匿名浏览器访问校园入口返回 200；portal_type=3 的官方 JSON 当前返回 7444 条，包含日常实习、ByteIntern 与大模型人才实习项目。',
  },
  {
    companyId: '018f0000-0000-7000-8000-000000000105',
    sourceId: '018f0000-0000-7000-8000-000000000205',
    slug: 'pinduoduo',
    sourceSlug: 'pinduoduo-intern',
    name: '拼多多',
    aliases: ['PDD'],
    sizeTag: 'medium',
    entry: 'https://careers.pddglobalhr.com/jobs',
    adapterKey: 'pinduoduo.intern',
    channel: 'intern',
    recruitmentType: 'campus',
    supportStatus: 'supported',
    supportNote:
      '实习接口匿名返回 2 条职位，分页、稳定 ID 和实习字段归一化已通过 Smoke；社招接口仍不接入。',
    config: { pageSize: 100 },
  },
  {
    companyId: '018f0000-0000-7000-8000-000000000106',
    sourceId: '018f0000-0000-7000-8000-000000000206',
    slug: 'meituan',
    sourceSlug: 'meituan-social',
    name: '美团',
    aliases: ['Meituan'],
    sizeTag: 'medium',
    entry: 'https://zhaopin.meituan.com/web/social',
    adapterKey: 'meituan.social',
    channel: 'social',
    recruitmentType: 'social',
    supportStatus: 'supported',
    supportNote: '公开 JSON 列表、详情、24 页全量分页和在线 Smoke 已于 2026-08-21 通过门禁。',
    config: { pageSize: 100 },
  },
  {
    companyId: '018f0000-0000-7000-8000-000000000106',
    sourceId: '018f0000-0000-7000-8000-000000000212',
    slug: 'meituan',
    sourceSlug: 'meituan-intern',
    name: '美团',
    aliases: ['Meituan'],
    sizeTag: 'medium',
    entry: 'https://zhaopin.meituan.com/web/campus',
    adapterKey: 'meituan.intern',
    channel: 'intern',
    recruitmentType: 'campus',
    supportStatus: 'supported',
    supportNote:
      '校园页初始化匿名会话后按 jobType=2 直接请求官方 JSON；totalCount/pageSize 响应驱动分页与两页在线 Smoke 已于 2026-08-23 通过。',
    config: { pageSize: 100 },
  },
  {
    companyId: '018f0000-0000-7000-8000-000000000107',
    sourceId: '018f0000-0000-7000-8000-000000000207',
    slug: 'dewu',
    name: '得物',
    aliases: ['Dewu'],
    sizeTag: 'medium',
    entry: 'https://poizon.jobs.feishu.cn/578078/position/list',
    adapterKey: 'dewu.campus',
    channel: 'campus',
    recruitmentType: 'campus',
    supportStatus: 'supported',
    supportNote:
      '校招/实习匿名浏览器由官网自身脚本生成动态签名；列表响应 count/limit/offset、6 个稳定 ID、官方详情 URL 和字段归一化已通过 Smoke。',
  },
  {
    companyId: '018f0000-0000-7000-8000-000000000108',
    sourceId: '018f0000-0000-7000-8000-000000000208',
    slug: 'xiaohongshu',
    name: '小红书',
    aliases: ['Xiaohongshu', 'RED'],
    sizeTag: 'medium',
    entry: 'https://job.xiaohongshu.com/campus/position',
    adapterKey: 'xiaohongshu.campus',
    channel: 'campus',
    recruitmentType: 'campus',
    supportStatus: 'supported',
    supportNote: '校招列表匿名分页、稳定 ID、字段归一化和在线 Smoke 已通过；默认低频串行。',
    config: { pageSize: 100 },
  },
  {
    companyId: '018f0000-0000-7000-8000-000000000109',
    sourceId: '018f0000-0000-7000-8000-000000000209',
    slug: 'jd',
    sourceSlug: 'jd-intern',
    name: '京东',
    aliases: ['JD'],
    sizeTag: 'medium',
    entry: 'https://campus.jd.com/#/jobs',
    adapterKey: 'jd.intern',
    channel: 'intern',
    recruitmentType: 'campus',
    supportStatus: 'supported',
    supportNote:
      '校园接口匿名返回实习职位，现以独立 intern source 输出；分页、稳定 publishId 和归一化已通过 Smoke。',
    config: { pageSize: 100 },
  },
  {
    companyId: '018f0000-0000-7000-8000-000000000110',
    sourceId: '018f0000-0000-7000-8000-000000000210',
    slug: 'huawei',
    sourceSlug: 'huawei-intern',
    name: '华为',
    aliases: ['Huawei'],
    sizeTag: 'medium',
    entry: 'https://career.huawei.com/cn/campus-recruitment-job-list?recruitmentType=INTERN',
    adapterKey: 'huawei.intern',
    channel: 'intern',
    recruitmentType: 'campus',
    supportStatus: 'supported',
    supportNote: '匿名实习页由官网脚本加载 31 条职位；4 页分页、稳定 ID 和字段归一化已通过 Smoke。',
  },
  {
    companyId: '018f0000-0000-7000-8000-000000000111',
    sourceId: '018f0000-0000-7000-8000-000000000214',
    slug: 'xiaomi',
    sourceSlug: 'xiaomi-intern',
    name: '小米',
    aliases: ['Xiaomi'],
    sizeTag: 'large',
    entry: 'https://hr.xiaomi.com/website/opportunities.html?project=%E5%AE%9E%E4%B9%A0',
    adapterKey: 'xiaomi.intern',
    channel: 'intern',
    recruitmentType: 'campus',
    supportStatus: 'supported',
    supportNote:
      '官网浏览器初始化匿名会话后捕获结构化 JSON；首页/中间页/末页 smoke、样本唯一 jobPostId、深链与归一化已于 2026-08-28 通过。',
    config: { pageSize: 100 },
  },
  {
    companyId: '018f0000-0000-7000-8000-000000000112',
    sourceId: '018f0000-0000-7000-8000-000000000215',
    slug: 'vivo',
    sourceSlug: 'vivo-social',
    name: 'vivo',
    aliases: ['Vivo'],
    sizeTag: 'large',
    entry: 'https://hr.vivo.com/jobs',
    adapterKey: 'vivo.social',
    channel: 'social',
    recruitmentType: 'social',
    supportStatus: 'supported',
    supportNote:
      '公开社招 JSON 的全量分页、稳定 ID、岗位级深链和字段归一化已于 2026-08-28 通过在线门禁。',
    config: { pageSize: 100 },
  },
  {
    companyId: '018f0000-0000-7000-8000-000000000113',
    sourceId: '018f0000-0000-7000-8000-000000000216',
    slug: 'oppo',
    sourceSlug: 'oppo-intern',
    name: 'OPPO',
    aliases: ['Oppo'],
    sizeTag: 'large',
    entry: 'https://careers.oppo.com/university/oppo/campus/post',
    adapterKey: 'oppo.intern',
    channel: 'intern',
    recruitmentType: 'campus',
    supportStatus: 'supported',
    supportNote:
      'Intern 项目 29 的全量分页、稳定 ID、岗位级深链和字段归一化已于 2026-08-28 通过在线门禁。',
    config: { pageSize: 100 },
  },
  {
    companyId: '018f0000-0000-7000-8000-000000000114',
    sourceId: '018f0000-0000-7000-8000-000000000217',
    slug: 'qihoo360',
    sourceSlug: 'qihoo360-social',
    name: '360',
    aliases: ['Qihoo 360'],
    sizeTag: 'large',
    entry: 'https://hr.360.cn/hr/list',
    adapterKey: 'qihoo360.social',
    channel: 'social',
    recruitmentType: 'social',
    supportStatus: 'supported',
    supportNote:
      '匿名浏览器列表 JSON 与官方 getjobone 详情 API 均于 2026-08-28 通过；稳定 ID、岗位深链、职责要求和经验字段归一化完成。',
    config: { pageSize: 10000 },
    requestsPerMinute: 6,
  },
  {
    companyId: '018f0000-0000-7000-8000-000000000115',
    sourceId: '018f0000-0000-7000-8000-000000000218',
    slug: 'netease',
    sourceSlug: 'netease-social',
    name: '网易',
    aliases: ['NetEase'],
    sizeTag: 'large',
    entry: 'https://hr.163.com/job-list.html',
    adapterKey: 'netease.social',
    channel: 'social',
    recruitmentType: 'social',
    supportStatus: 'supported',
    supportNote:
      '官网浏览器初始化匿名会话后捕获混合结构化 JSON；首页/中间页/末页 smoke 与记录级社招筛选、样本唯一 ID、深链及归一化已于 2026-08-28 通过。',
    config: { pageSize: 100 },
  },
];

const missingChannelInputs: readonly CatalogInput[] = [
  {
    companyId: '018f0000-0000-7000-8000-000000000102',
    sourceId: '018f0000-0000-7000-8000-000000000220',
    slug: 'alibaba',
    sourceSlug: 'alibaba-intern',
    name: '阿里巴巴',
    aliases: ['Alibaba'],
    sizeTag: 'large',
    entry: 'https://campus-talent.alibaba.com/campus/position?batchId=100000560002',
    adapterKey: 'alibaba.intern',
    channel: 'intern',
    recruitmentType: 'campus',
    supportStatus: 'supported',
    supportNote:
      '复用校园官网浏览器协议，按记录级类别筛选；独立实习渠道首页/末页/中间页 smoke、样本唯一 ID 与归一化已于 2026-08-28 通过。',
  },
  {
    companyId: '018f0000-0000-7000-8000-000000000102',
    sourceId: '018f0000-0000-7000-8000-000000000221',
    slug: 'alibaba',
    sourceSlug: 'alibaba-social',
    name: '阿里巴巴',
    aliases: ['Alibaba'],
    sizeTag: 'large',
    entry: 'https://talent.alibaba.com/off-campus/position-list',
    adapterKey: 'alibaba.social',
    channel: 'social',
    recruitmentType: 'social',
    supportStatus: 'supported',
    supportNote:
      '控股集团官网 off-campus 匿名浏览器 JSON 已独立适配；首页/中间页/末页、唯一 ID、岗位深链与 social 归一化已于 2026-08-28 通过。',
    config: { pageSize: 100 },
  },
  {
    companyId: '018f0000-0000-7000-8000-000000000103',
    sourceId: '018f0000-0000-7000-8000-000000000222',
    slug: 'baidu',
    sourceSlug: 'baidu-intern',
    name: '百度',
    aliases: ['Baidu'],
    sizeTag: 'large',
    entry: 'https://talent.baidu.com/jobs/list?recruitType=INTERN',
    adapterKey: 'baidu.intern',
    channel: 'intern',
    recruitmentType: 'campus',
    supportStatus: 'supported',
    supportNote: '官方 INTERN 分页已验证 458 条，现按记录级招聘类别独立输出。',
  },
  {
    companyId: '018f0000-0000-7000-8000-000000000103',
    sourceId: '018f0000-0000-7000-8000-000000000223',
    slug: 'baidu',
    sourceSlug: 'baidu-social',
    name: '百度',
    aliases: ['Baidu'],
    sizeTag: 'large',
    entry: 'https://talent.baidu.com/jobs/list?recruitType=SOCIAL',
    adapterKey: 'baidu.social',
    channel: 'social',
    recruitmentType: 'social',
    supportStatus: 'supported',
    supportNote:
      '官方 SOCIAL 匿名表单 JSON 完整分页、稳定 postId、岗位级 URL 与字段归一化已于 2026-08-28 通过在线门禁。',
    config: { pageSize: 20 },
  },
  {
    companyId: '018f0000-0000-7000-8000-000000000104',
    sourceId: '018f0000-0000-7000-8000-000000000224',
    slug: 'bytedance',
    sourceSlug: 'bytedance-intern',
    name: '字节跳动',
    aliases: ['ByteDance'],
    sizeTag: 'large',
    entry: 'https://jobs.bytedance.com/campus/position',
    adapterKey: 'bytedance.intern',
    channel: 'intern',
    recruitmentType: 'campus',
    supportStatus: 'supported',
    supportNote:
      '复用校园官网浏览器协议，按记录级类别筛选；独立实习渠道首页/末页/中间页 smoke、样本唯一 ID 与归一化已于 2026-08-28 通过。',
  },
  {
    companyId: '018f0000-0000-7000-8000-000000000105',
    sourceId: '018f0000-0000-7000-8000-000000000225',
    slug: 'pinduoduo',
    sourceSlug: 'pinduoduo-campus',
    name: '拼多多',
    aliases: ['PDD'],
    sizeTag: 'medium',
    entry: 'https://careers.pddglobalhr.com/jobs',
    adapterKey: 'pinduoduo.campus',
    channel: 'campus',
    recruitmentType: 'campus',
    supportStatus: 'supported',
    supportNote:
      '校园官网 grad 正式岗位匿名 JSON 共两页；总数、唯一 ID、深链与 campus 归一化已于 2026-08-28 通过。',
    config: { pageSize: 10 },
  },
  {
    companyId: '018f0000-0000-7000-8000-000000000105',
    sourceId: '018f0000-0000-7000-8000-000000000226',
    slug: 'pinduoduo',
    sourceSlug: 'pinduoduo-social',
    name: '拼多多',
    aliases: ['PDD'],
    sizeTag: 'medium',
    entry: 'https://careers.pddglobalhr.com/jobs',
    adapterKey: 'pinduoduo.social',
    channel: 'social',
    recruitmentType: 'social',
    supportStatus: 'blocked',
    supportNote:
      '普通 Chrome 空白 profile 首屏加载后 CDP 附加的三轮首页/末页/详情 smoke 已通过；专用 session-driven driver 尚未工程化。',
  },
  {
    companyId: '018f0000-0000-7000-8000-000000000106',
    sourceId: '018f0000-0000-7000-8000-000000000227',
    slug: 'meituan',
    sourceSlug: 'meituan-campus',
    name: '美团',
    aliases: ['Meituan'],
    sizeTag: 'medium',
    entry: 'https://zhaopin.meituan.com/web/campus',
    adapterKey: 'meituan.campus',
    channel: 'campus',
    recruitmentType: 'campus',
    supportStatus: 'supported',
    supportNote:
      '校园官网 jobType=1 的 185 个正式岗位以单页 200 条完整返回，稳定 jobUnionId、详情与 campus 归一化已于 2026-08-28 通过在线门禁。',
    config: { pageSize: 200 },
  },
  {
    companyId: '018f0000-0000-7000-8000-000000000107',
    sourceId: '018f0000-0000-7000-8000-000000000228',
    slug: 'dewu',
    sourceSlug: 'dewu-intern',
    name: '得物',
    aliases: ['Dewu'],
    sizeTag: 'medium',
    entry: 'https://poizon.jobs.feishu.cn/578078/position/list',
    adapterKey: 'dewu.intern',
    channel: 'intern',
    recruitmentType: 'campus',
    supportStatus: 'supported',
    supportNote:
      '复用飞书 ATS 校园浏览器协议，按记录级类别筛选；当前列表不超过三页，边界 smoke、样本唯一 ID 与归一化已于 2026-08-28 通过。',
  },
  {
    companyId: '018f0000-0000-7000-8000-000000000107',
    sourceId: '018f0000-0000-7000-8000-000000000229',
    slug: 'dewu',
    sourceSlug: 'dewu-social',
    name: '得物',
    aliases: ['Dewu'],
    sizeTag: 'medium',
    entry: 'https://poizon.jobs.feishu.cn/index/position',
    adapterKey: 'dewu.social',
    channel: 'social',
    recruitmentType: 'social',
    supportStatus: 'supported',
    supportNote:
      '飞书 ATS Experienced 入口由正常匿名浏览器生成签名；首页/中间页/末页、唯一 ID 与 social 归一化已于 2026-08-28 通过。',
  },
  {
    companyId: '018f0000-0000-7000-8000-000000000108',
    sourceId: '018f0000-0000-7000-8000-000000000230',
    slug: 'xiaohongshu',
    sourceSlug: 'xiaohongshu-intern',
    name: '小红书',
    aliases: ['Xiaohongshu', 'RED'],
    sizeTag: 'medium',
    entry: 'https://job.xiaohongshu.com/campus/position',
    adapterKey: 'xiaohongshu.intern',
    channel: 'intern',
    recruitmentType: 'campus',
    supportStatus: 'supported',
    config: { pageSize: 100 },
    supportNote:
      '复用校园官网匿名 JSON，完整遍历物理列表后按记录级类别筛选；独立实习渠道全量、唯一 ID 与归一化门禁已于 2026-08-28 通过。',
  },
  {
    companyId: '018f0000-0000-7000-8000-000000000108',
    sourceId: '018f0000-0000-7000-8000-000000000231',
    slug: 'xiaohongshu',
    sourceSlug: 'xiaohongshu-social',
    name: '小红书',
    aliases: ['Xiaohongshu', 'RED'],
    sizeTag: 'medium',
    entry: 'https://job.xiaohongshu.com/social/position',
    adapterKey: 'xiaohongshu.social',
    channel: 'social',
    recruitmentType: 'social',
    supportStatus: 'supported',
    supportNote:
      '社招官网 pageQueryPosition 匿名 JSON 已独立建模；首页/末页、稳定 positionId 与字段归一化 Smoke 已于 2026-08-28 通过。',
    config: { pageSize: 100 },
  },
  {
    companyId: '018f0000-0000-7000-8000-000000000109',
    sourceId: '018f0000-0000-7000-8000-000000000232',
    slug: 'jd',
    sourceSlug: 'jd-campus',
    name: '京东',
    aliases: ['JD'],
    sizeTag: 'medium',
    entry: 'https://campus.jd.com/#/jobs',
    adapterKey: 'jd.campus',
    channel: 'campus',
    recruitmentType: 'campus',
    supportStatus: 'supported',
    supportNote:
      '校园官网正式岗位计划 47/56/57/58 已独立建模；首页/末页、稳定 publishId 与字段归一化 Smoke 已于 2026-08-28 通过。',
    config: { pageSize: 100, planIdList: ['47', '56', '57', '58'] },
  },
  {
    companyId: '018f0000-0000-7000-8000-000000000109',
    sourceId: '018f0000-0000-7000-8000-000000000233',
    slug: 'jd',
    sourceSlug: 'jd-social',
    name: '京东',
    aliases: ['JD'],
    sizeTag: 'medium',
    entry: 'https://zhaopin.jd.com/web/job/job_info_list/3',
    adapterKey: 'jd.social',
    channel: 'social',
    recruitmentType: 'social',
    supportStatus: 'supported',
    supportNote:
      '匿名社招接口首页与末页 smoke 已于 2026-08-28 通过：总数与末页长度一致、样本 requirementId 唯一且归一化正确。全量跨页重复仍按 partial 报告。',
    config: { pageSize: 100 },
  },
  {
    companyId: '018f0000-0000-7000-8000-000000000110',
    sourceId: '018f0000-0000-7000-8000-000000000234',
    slug: 'huawei',
    sourceSlug: 'huawei-campus',
    name: '华为',
    aliases: ['Huawei'],
    sizeTag: 'medium',
    entry: 'https://career.huawei.com/cn/campus-recruitment-job-list?recruitmentType=INTERN',
    adapterKey: 'huawei.campus',
    channel: 'campus',
    recruitmentType: 'campus',
    supportStatus: 'supported',
    supportNote:
      '校园官网不带 recruitmentType 时返回正式校招岗位；匿名浏览器首页/中间页/末页、唯一 ID 与 campus 归一化已于 2026-08-28 通过。',
    config: { pageSize: 100, recruitmentType: [] },
  },
  {
    companyId: '018f0000-0000-7000-8000-000000000110',
    sourceId: '018f0000-0000-7000-8000-000000000235',
    slug: 'huawei',
    sourceSlug: 'huawei-social',
    name: '华为',
    aliases: ['Huawei'],
    sizeTag: 'medium',
    entry: 'https://career.huawei.com/reccampportal/portal5/social-recruitment.html',
    adapterKey: 'huawei.social',
    channel: 'social',
    recruitmentType: 'social',
    supportStatus: 'supported',
    supportNote:
      '社招官网 newHr 匿名 JSON 当前以每页 2 条完成首页/末页 smoke；总数、唯一 jobId、详情深链与归一化已于 2026-08-28 通过。',
    config: { pageSize: 100 },
  },
  {
    companyId: '018f0000-0000-7000-8000-000000000111',
    sourceId: '018f0000-0000-7000-8000-000000000236',
    slug: 'xiaomi',
    sourceSlug: 'xiaomi-campus',
    name: '小米',
    aliases: ['Xiaomi'],
    sizeTag: 'large',
    entry: 'https://hr.xiaomi.com/website/opportunities.html?project=%E6%A0%A1%E6%8B%9B',
    adapterKey: 'xiaomi.campus',
    channel: 'campus',
    recruitmentType: 'campus',
    supportStatus: 'supported',
    supportNote:
      '正常匿名浏览器捕获官网 type=2 结构化 JSON；首页/中间页/末页、唯一 jobPostId、深链与 campus 归一化已于 2026-08-28 通过。',
    config: { pageSize: 100 },
  },
  {
    companyId: '018f0000-0000-7000-8000-000000000111',
    sourceId: '018f0000-0000-7000-8000-000000000237',
    slug: 'xiaomi',
    sourceSlug: 'xiaomi-social',
    name: '小米',
    aliases: ['Xiaomi'],
    sizeTag: 'large',
    entry: 'https://hr.xiaomi.com/website/opportunities.html',
    adapterKey: 'xiaomi.social',
    channel: 'social',
    recruitmentType: 'social',
    supportStatus: 'supported',
    supportNote:
      '正常匿名浏览器捕获官网 type=1 结构化 JSON；首页/中间页/末页、唯一 jobPostId、深链与 social 归一化已于 2026-08-28 通过。',
    config: { pageSize: 100 },
  },
  {
    companyId: '018f0000-0000-7000-8000-000000000112',
    sourceId: '018f0000-0000-7000-8000-000000000238',
    slug: 'vivo',
    sourceSlug: 'vivo-intern',
    name: 'vivo',
    aliases: ['Vivo'],
    sizeTag: 'large',
    entry: 'https://hr-campus.vivo.com/jobs',
    adapterKey: 'vivo.intern',
    channel: 'intern',
    recruitmentType: 'campus',
    supportStatus: 'supported',
    config: { pageSize: 300 },
    supportNote:
      '校园官网 Category=3 的 92 个实习岗位单页完整返回，稳定 UUID、岗位深链和 internship 归一化已于 2026-08-28 通过匿名在线门禁。',
  },
  {
    companyId: '018f0000-0000-7000-8000-000000000112',
    sourceId: '018f0000-0000-7000-8000-000000000239',
    slug: 'vivo',
    sourceSlug: 'vivo-campus',
    name: 'vivo',
    aliases: ['Vivo'],
    sizeTag: 'large',
    entry: 'https://hr-campus.vivo.com/jobs',
    adapterKey: 'vivo.campus',
    channel: 'campus',
    recruitmentType: 'campus',
    supportStatus: 'supported',
    config: { pageSize: 300 },
    supportNote:
      '校园官网 Category=2 的 164 个正式岗位单页完整返回，稳定 UUID、岗位深链和 campus 归一化已于 2026-08-28 通过匿名在线门禁。',
  },
  {
    companyId: '018f0000-0000-7000-8000-000000000113',
    sourceId: '018f0000-0000-7000-8000-000000000240',
    slug: 'oppo',
    sourceSlug: 'oppo-campus',
    name: 'OPPO',
    aliases: ['Oppo'],
    sizeTag: 'large',
    entry: 'https://careers.oppo.com/university/oppo/campus/post',
    adapterKey: 'oppo.campus',
    channel: 'campus',
    recruitmentType: 'campus',
    supportStatus: 'supported',
    config: { pageSize: 300 },
    supportNote:
      '校园官网 Graduate 项目 30 与 doctor 项目 31 共 140 个岗位单页完整返回，稳定 idRecruitPosition、岗位深链与 campus 归一化已于 2026-08-28 通过匿名在线门禁。',
  },
  {
    companyId: '018f0000-0000-7000-8000-000000000113',
    sourceId: '018f0000-0000-7000-8000-000000000241',
    slug: 'oppo',
    sourceSlug: 'oppo-social',
    name: 'OPPO',
    aliases: ['Oppo'],
    sizeTag: 'large',
    entry: 'https://career.oppo.com/recruitment/post?recruitType=SOCIAL-RECRUITMENT',
    adapterKey: 'oppo.social',
    channel: 'social',
    recruitmentType: 'social',
    supportStatus: 'supported',
    config: { pageSize: 200 },
    supportNote:
      '社招官网匿名 ATS API 返回 139 个岗位，单页完整返回，稳定 positionId、岗位深链与字段归一化已于 2026-08-28 通过在线门禁。',
  },
  {
    companyId: '018f0000-0000-7000-8000-000000000114',
    sourceId: '018f0000-0000-7000-8000-000000000242',
    slug: 'qihoo360',
    sourceSlug: 'qihoo360-intern',
    name: '360',
    aliases: ['Qihoo 360'],
    sizeTag: 'large',
    entry: 'https://campus.360.cn/',
    adapterKey: 'qihoo360.intern',
    channel: 'intern',
    recruitmentType: 'campus',
    supportStatus: 'supported',
    supportNote:
      'campus.360.cn 已迁移至 360campus.zhiye.com；Category=3 匿名 JSON 两页、唯一 UUID、深链与 internship 归一化已通过。',
    config: { pageSize: 100 },
  },
  {
    companyId: '018f0000-0000-7000-8000-000000000114',
    sourceId: '018f0000-0000-7000-8000-000000000243',
    slug: 'qihoo360',
    sourceSlug: 'qihoo360-campus',
    name: '360',
    aliases: ['Qihoo 360'],
    sizeTag: 'large',
    entry: 'https://campus.360.cn/',
    adapterKey: 'qihoo360.campus',
    channel: 'campus',
    recruitmentType: 'campus',
    supportStatus: 'supported',
    supportNote:
      'campus.360.cn 已迁移至 360campus.zhiye.com；Category=2 匿名 JSON 两页、唯一 UUID、深链与 campus 归一化已通过。',
    config: { pageSize: 100 },
  },
  {
    companyId: '018f0000-0000-7000-8000-000000000115',
    sourceId: '018f0000-0000-7000-8000-000000000244',
    slug: 'netease',
    sourceSlug: 'netease-intern',
    name: '网易',
    aliases: ['NetEase'],
    sizeTag: 'large',
    entry: 'https://hr.163.com/job-list.html',
    adapterKey: 'netease.intern',
    channel: 'intern',
    recruitmentType: 'campus',
    supportStatus: 'supported',
    supportNote:
      '官网浏览器初始化匿名会话后捕获混合结构化 JSON；首页/中间页/末页 smoke 与记录级实习筛选、样本唯一 ID、深链及归一化已于 2026-08-28 通过。',
    config: { pageSize: 100 },
  },
  {
    companyId: '018f0000-0000-7000-8000-000000000115',
    sourceId: '018f0000-0000-7000-8000-000000000245',
    slug: 'netease',
    sourceSlug: 'netease-campus-internet',
    name: '网易',
    aliases: ['NetEase'],
    sizeTag: 'large',
    entry: 'https://campus.163.com/',
    adapterKey: 'netease.campus.internet',
    channel: 'campus',
    recruitmentType: 'campus',
    supportStatus: 'supported',
    supportNote:
      '网易互联网 2027 校招 projectId=103 官方 JSON 两页、唯一 ID、深链与 campus 归一化已于 2026-08-28 通过。',
    config: { pageSize: 50 },
  },
  {
    companyId: '018f0000-0000-7000-8000-000000000115',
    sourceId: '018f0000-0000-7000-8000-000000000246',
    slug: 'netease',
    sourceSlug: 'netease-campus-games',
    name: '网易',
    aliases: ['NetEase'],
    sizeTag: 'large',
    entry: 'https://game.campus.163.com/',
    adapterKey: 'netease.campus.games',
    channel: 'campus',
    recruitmentType: 'campus',
    supportStatus: 'supported',
    supportNote:
      '网易互娱 2027 校招 projectId=102 官方 JSON 两页、唯一 ID、深链与 campus 归一化已于 2026-08-28 通过。',
    config: { pageSize: 50 },
  },
  {
    companyId: '018f0000-0000-7000-8000-000000000115',
    sourceId: '018f0000-0000-7000-8000-000000000247',
    slug: 'netease',
    sourceSlug: 'netease-campus-leihuo',
    name: '网易',
    aliases: ['NetEase'],
    sizeTag: 'large',
    entry: 'https://leihuo.163.com/campus/',
    adapterKey: 'netease.campus.leihuo',
    channel: 'campus',
    recruitmentType: 'campus',
    supportStatus: 'supported',
    supportNote:
      '网易雷火 2027 校招 project_id=77 官方 JSON 两页、唯一 ehr_job_id、深链与 campus 归一化已于 2026-08-28 通过。',
    config: { pageSize: 50 },
  },
  {
    companyId: '018f0000-0000-7000-8000-000000000101',
    sourceId: '018f0000-0000-7000-8000-000000000248',
    slug: 'tencent',
    sourceSlug: 'tencent-campus',
    name: '腾讯',
    aliases: ['Tencent'],
    sizeTag: 'large',
    entry: 'https://join.qq.com/post.html',
    adapterKey: 'tencent.campus',
    channel: 'campus',
    recruitmentType: 'campus',
    supportStatus: 'supported',
    supportNote:
      '校园官网 projectMappingId=1 的应届毕业生列表、完整分页、稳定 postId 与岗位详情已于 2026-08-28 通过匿名在线门禁。',
    config: { pageSize: 100 },
  },
];

const canonicalInputs = [...inputs, ...missingChannelInputs] as const;
const channelTypes = ['intern', 'campus', 'social'] as const;
const companyInputs = Array.from(
  new Map(canonicalInputs.map((input) => [input.companyId, input])).values(),
);

/** 执行来源数据的解析、转换、请求或分页逻辑。 */
function channelId(companyId: string, channel: SourceChannel): string {
  const channelCode = { intern: '01', campus: '02', social: '03' }[channel];
  const companySuffix = companyId.replaceAll('-', '').slice(-10);
  return `018f0000-0000-7000-8200-${companySuffix}${channelCode}`;
}

/** 执行来源数据的解析、转换、请求或分页逻辑。 */
function physicalSource(input: CatalogInput): FirstPartyPhysicalSourceSeed {
  return {
    id: input.sourceId,
    slug: input.sourceSlug ?? `${input.slug}-${input.recruitmentType}`,
    adapterKey: input.adapterKey,
    recruitmentType: input.recruitmentType,
    baseUrl: input.entry,
    config: input.config ?? {},
    enabledByDefault: input.supportStatus === 'supported',
    supportStatus: input.supportStatus,
    supportNote: input.supportNote,
    coverageRole: input.coverageRole ?? 'required',
    defaultRateLimit: {
      requestsPerMinute: input.requestsPerMinute ?? 12,
      burst: 1,
    },
  };
}

/** 招聘来源目录数据。 */
export const firstPartySourceCatalog: readonly FirstPartySourceChannelSeed[] =
  companyInputs.flatMap((company) =>
    channelTypes.map((channel) => {
      const members = canonicalInputs.filter(
        (input) => input.companyId === company.companyId && input.channel === channel,
      );
      return {
        company: {
          id: company.companyId,
          slug: company.slug,
          name: company.name,
          aliases: company.aliases ?? [],
          industry: '互联网/科技',
          sizeTag: company.sizeTag,
        },
        channel: {
          id: channelId(company.companyId, channel),
          slug: `${company.slug}-${channel}`,
          type: channel,
          enabledByDefault:
            channel === 'intern' && members.some((input) => input.supportStatus === 'supported'),
          supportNote:
            members.length === 0
              ? '尚未发现可验证的官方物理来源。'
              : members.every((input) => input.supportStatus === 'blocked')
                ? members
                    .map((input) => input.supportNote)
                    .filter(Boolean)
                    .join('；')
                : null,
        },
        sources: members.map(physicalSource),
      };
    }),
  );

/** 招聘来源目录数据。 */
export const firstPartyPhysicalSourceCatalog: readonly FirstPartySourceSeed[] = canonicalInputs.map(
  (input) => {
    const channel = firstPartySourceCatalog.find(
      (record) => record.company.id === input.companyId && record.channel.type === input.channel,
    );
    if (!channel) throw new TypeError(`Missing logical channel for ${input.adapterKey}.`);
    return { company: channel.company, channel: channel.channel, source: physicalSource(input) };
  },
);
