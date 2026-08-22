import type { AdapterRegistry } from '@jobhunter/source-core';
import { createBaiduAdapter } from '../baidu/index.js';
import {
  createAlibabaAdapter,
  createByteDanceAdapter,
  createDewuAdapter,
  createHuaweiAdapter,
  createXiaohongshuAdapter,
} from '../scripted/index.js';
import { createJdCampusAdapter } from '../jd-campus/index.js';
import { createMeituanAdapter } from '../meituan/index.js';
import { createPinduoduoAdapter } from '../pinduoduo/index.js';
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
  readonly adapterKey: string;
  readonly recruitmentType: 'social' | 'campus' | 'mixed';
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
    adapterKey: 'tencent.social',
    recruitmentType: 'social',
    supportStatus: 'supported',
    supportNote: '公开匿名 JSON 列表与详情协议已于 2026-08-20 通过门禁。',
  },
  {
    slug: 'alibaba',
    name: '阿里巴巴',
    aliases: ['Alibaba'],
    sizeTag: 'large',
    entry: 'https://campus-talent.alibaba.com/campus/position?batchId=100000560002',
    adapterKey: 'alibaba.campus',
    recruitmentType: 'campus',
    supportStatus: 'supported',
    supportNote:
      '匿名浏览器由官网自身脚本生成运行时请求；339 条职位、34 页分页、稳定 ID 和字段归一化已通过 Smoke。',
  },
  {
    slug: 'baidu',
    name: '百度',
    aliases: ['Baidu'],
    sizeTag: 'large',
    entry: 'https://talent.baidu.com/jobs/list?recruitType=INTERN',
    adapterKey: 'baidu.campus',
    recruitmentType: 'campus',
    supportStatus: 'supported',
    supportNote:
      '匿名校园 JSON 接口按实习优先采集；617 条职位、31 页分页、稳定 ID 和字段归一化已通过 Smoke。',
  },
  {
    slug: 'bytedance',
    name: '字节跳动',
    aliases: ['ByteDance'],
    sizeTag: 'large',
    entry: 'https://jobs.bytedance.com/experienced/position',
    adapterKey: 'bytedance.social',
    recruitmentType: 'social',
    supportStatus: 'supported',
    supportNote:
      '匿名浏览器由官网自身脚本生成动态签名；列表响应的 count/limit/offset 分页、稳定 ID、官方详情 URL 和字段归一化已通过 Smoke。',
  },
  {
    slug: 'pinduoduo',
    name: '拼多多',
    aliases: ['PDD'],
    sizeTag: 'medium',
    entry: 'https://careers.pddglobalhr.com/jobs',
    adapterKey: 'pinduoduo.intern',
    recruitmentType: 'campus',
    supportStatus: 'supported',
    supportNote:
      '实习接口匿名返回 2 条职位，分页、稳定 ID 和实习字段归一化已通过 Smoke；社招接口仍不接入。',
  },
  {
    slug: 'meituan',
    name: '美团',
    aliases: ['Meituan'],
    sizeTag: 'medium',
    entry: 'https://zhaopin.meituan.com/web/social',
    adapterKey: 'meituan.social',
    recruitmentType: 'social',
    supportStatus: 'supported',
    supportNote: '公开 JSON 列表、详情、24 页全量分页和在线 Smoke 已于 2026-08-21 通过门禁。',
  },
  {
    slug: 'dewu',
    name: '得物',
    aliases: ['Dewu'],
    sizeTag: 'medium',
    entry: 'https://poizon.jobs.feishu.cn/578078/position/list',
    adapterKey: 'dewu.campus',
    recruitmentType: 'campus',
    supportStatus: 'supported',
    supportNote:
      '校招/实习匿名浏览器由官网自身脚本生成动态签名；列表响应 count/limit/offset、6 个稳定 ID、官方详情 URL 和字段归一化已通过 Smoke。',
  },
  {
    slug: 'xiaohongshu',
    name: '小红书',
    aliases: ['Xiaohongshu', 'RED'],
    sizeTag: 'medium',
    entry: 'https://job.xiaohongshu.com/social/position',
    adapterKey: 'xiaohongshu.campus',
    recruitmentType: 'campus',
    supportStatus: 'supported',
    supportNote: '校招列表匿名分页、稳定 ID、字段归一化和在线 Smoke 已通过；默认低频串行。',
  },
  {
    slug: 'jd',
    name: '京东',
    aliases: ['JD'],
    sizeTag: 'medium',
    entry: 'https://zhaopin.jd.com/web/job/job_info_list/3',
    adapterKey: 'jd.campus',
    recruitmentType: 'campus',
    supportStatus: 'supported',
    supportNote:
      '校园接口匿名返回 75 条职位，分页、稳定 publishId、岗位职责归一化和官方入口 URL 已通过 Smoke。',
  },
  {
    slug: 'huawei',
    name: '华为',
    aliases: ['Huawei'],
    sizeTag: 'medium',
    entry: 'https://career.huawei.com/cn/campus-recruitment-job-list?recruitmentType=INTERN',
    adapterKey: 'huawei.campus',
    recruitmentType: 'campus',
    supportStatus: 'supported',
    supportNote: '匿名实习页由官网脚本加载 31 条职位；4 页分页、稳定 ID 和字段归一化已通过 Smoke。',
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
        slug: `${input.slug}-${input.recruitmentType}`,
        adapterKey: input.adapterKey,
        recruitmentType: input.recruitmentType,
        baseUrl: input.entry,
        config:
          input.slug === 'tencent' ||
          input.slug === 'meituan' ||
          input.slug === 'xiaohongshu' ||
          input.slug === 'jd' ||
          input.slug === 'pinduoduo'
            ? { pageSize: 100 }
            : {},
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
  registry.register(createAlibabaAdapter());
  registry.register(createBaiduAdapter());
  registry.register(createByteDanceAdapter());
  registry.register(createDewuAdapter());
  registry.register(createHuaweiAdapter());
  registry.register(createJdCampusAdapter());
  registry.register(createMeituanAdapter());
  registry.register(createPinduoduoAdapter());
  registry.register(createTencentAdapter());
  registry.register(createXiaohongshuAdapter());
}
