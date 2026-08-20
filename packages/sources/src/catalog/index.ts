import type { AdapterRegistry } from '@jobhunter/source-core';
import { createTencentAdapter } from '../tencent/index.js';

export type SourceSupportStatus = 'experimental' | 'supported' | 'blocked';

export interface FirstPartySourceSeed {
  readonly company: {
    readonly id: string;
    readonly slug: string;
    readonly name: string;
    readonly aliases: readonly string[];
    readonly industry: string | null;
    readonly sizeTag: 'large' | 'medium' | 'other';
  };
  readonly source: {
    readonly id: string;
    readonly slug: string;
    readonly adapterKey: string;
    readonly recruitmentType: 'social' | 'campus' | 'mixed';
    readonly baseUrl: string;
    readonly config: Readonly<Record<string, unknown>>;
    readonly enabledByDefault: boolean;
    readonly supportStatus: SourceSupportStatus;
    readonly supportNote: string | null;
    readonly defaultRateLimit: {
      readonly requestsPerMinute: number;
      readonly burst: number;
    };
  };
}

const ids = [
  ['018f0000-0000-7000-8000-000000000101', '018f0000-0000-7000-8000-000000000201'],
  ['018f0000-0000-7000-8000-000000000102', '018f0000-0000-7000-8000-000000000202'],
  ['018f0000-0000-7000-8000-000000000103', '018f0000-0000-7000-8000-000000000203'],
  ['018f0000-0000-7000-8000-000000000104', '018f0000-0000-7000-8000-000000000204'],
  ['018f0000-0000-7000-8000-000000000105', '018f0000-0000-7000-8000-000000000205'],
  ['018f0000-0000-7000-8000-000000000106', '018f0000-0000-7000-8000-000000000206'],
  ['018f0000-0000-7000-8000-000000000107', '018f0000-0000-7000-8000-000000000207'],
  ['018f0000-0000-7000-8000-000000000108', '018f0000-0000-7000-8000-000000000208'],
  ['018f0000-0000-7000-8000-000000000109', '018f0000-0000-7000-8000-000000000209'],
  ['018f0000-0000-7000-8000-000000000110', '018f0000-0000-7000-8000-000000000210'],
] as const;

interface CatalogInput {
  readonly slug: string;
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly sizeTag: 'large' | 'medium';
  readonly entry: string;
  readonly supportStatus: SourceSupportStatus;
  readonly supportNote: string | null;
  readonly requestsPerMinute?: number;
}

const inputs: readonly CatalogInput[] = [
  {
    slug: 'tencent',
    name: '腾讯',
    aliases: ['Tencent'],
    sizeTag: 'large',
    entry: 'https://careers.tencent.com/search.html',
    supportStatus: 'supported',
    supportNote: '公开匿名 JSON 列表与详情协议已于 2026-08-20 通过门禁。',
  },
  {
    slug: 'alibaba',
    name: '阿里巴巴',
    aliases: ['Alibaba'],
    sizeTag: 'large',
    entry: 'https://talent.alibaba.com/off-campus',
    supportStatus: 'blocked',
    supportNote: '尚未取得当前社招公开职位与完整分页证据。',
  },
  {
    slug: 'baidu',
    name: '百度',
    aliases: ['Baidu'],
    sizeTag: 'large',
    entry: 'https://talent.baidu.com/jobs/social',
    supportStatus: 'blocked',
    supportNote: '社招路由与匿名职位集合尚未通过当日复核。',
  },
  {
    slug: 'bytedance',
    name: '字节跳动',
    aliases: ['ByteDance'],
    sizeTag: 'large',
    entry: 'https://jobs.bytedance.com/experienced/position',
    supportStatus: 'experimental',
    supportNote: '公开搜索页可见，但验证码与分页完整性门禁未完成。',
  },
  {
    slug: 'pinduoduo',
    name: '拼多多',
    aliases: ['PDD'],
    sizeTag: 'medium',
    entry: 'https://careers.pddglobalhr.com/jobs',
    supportStatus: 'experimental',
    supportNote: '页面可匿名查看，但列表请求要求风控 anti_content；项目不生成或规避该机制。',
  },
  {
    slug: 'meituan',
    name: '美团',
    aliases: ['Meituan'],
    sizeTag: 'medium',
    entry: 'https://zhaopin.meituan.com/web/social',
    supportStatus: 'experimental',
    supportNote: '公开搜索页可见，列表、详情与分页协议门禁未完成。',
  },
  {
    slug: 'dewu',
    name: '得物',
    aliases: ['Dewu'],
    sizeTag: 'medium',
    entry: 'https://careers.dewu.com/index/',
    supportStatus: 'blocked',
    supportNote: '官网入口与飞书招聘站的权威关系、匿名范围尚未验证。',
  },
  {
    slug: 'xiaohongshu',
    name: '小红书',
    aliases: ['Xiaohongshu', 'RED'],
    sizeTag: 'medium',
    entry: 'https://job.xiaohongshu.com/social/position',
    supportStatus: 'experimental',
    supportNote: '公开页面可见，验证码停止路径与分页门禁未完成。',
  },
  {
    slug: 'jd',
    name: '京东',
    aliases: ['JD'],
    sizeTag: 'medium',
    entry: 'https://zhaopin.jd.com/web/job/job_info_list/3',
    supportStatus: 'experimental',
    supportNote: '已确认社招入口，但匿名分页与详情门禁未完成。',
  },
  {
    slug: 'huawei',
    name: '华为',
    aliases: ['Huawei'],
    sizeTag: 'medium',
    entry: 'https://career.huawei.com/reccampportal/portal5/social-recruitment.html',
    supportStatus: 'blocked',
    supportNote: '目标运行环境被客户端策略拦截，未取得可交付的匿名协议证据。',
  },
];

export const firstPartySourceCatalog: readonly FirstPartySourceSeed[] = inputs.map(
  (input, index) => {
    const pair = ids[index];
    if (!pair) throw new Error('First-party source ID catalog is incomplete.');
    return {
      company: {
        id: pair[0],
        slug: input.slug,
        name: input.name,
        aliases: input.aliases ?? [],
        industry: '互联网/科技',
        sizeTag: input.sizeTag,
      },
      source: {
        id: pair[1],
        slug: `${input.slug}-social`,
        adapterKey: `${input.slug}.social`,
        recruitmentType: 'social',
        baseUrl: input.entry,
        config: input.slug === 'tencent' ? { language: 'zh-cn', pageSize: 100 } : {},
        enabledByDefault: input.supportStatus === 'supported',
        supportStatus: input.supportStatus,
        supportNote: input.supportNote,
        defaultRateLimit: {
          requestsPerMinute: input.requestsPerMinute ?? 12,
          burst: 1,
        },
      },
    };
  },
);

export function registerFirstPartyAdapters(registry: AdapterRegistry): void {
  registry.register(createTencentAdapter());
}
