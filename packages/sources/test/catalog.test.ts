import { AdapterRegistry } from '@jobhunter/source-core';
import { describe, expect, it } from 'vitest';
import {
  firstPartyPhysicalSourceCatalog,
  firstPartySourceCatalog,
  registerFirstPartyAdapters,
} from '../src/index.js';

describe('first-party source catalog', () => {
  it('preserves original source identities while canonicalizing channel slugs', () => {
    expect(
      firstPartyPhysicalSourceCatalog.slice(0, 13).map((record) => ({
        companyId: record.company.id,
        sourceId: record.source.id,
        sourceSlug: record.source.slug,
        adapterKey: record.source.adapterKey,
        enabled: record.source.enabledByDefault,
      })),
    ).toEqual([
      {
        companyId: '018f0000-0000-7000-8000-000000000101',
        sourceId: '018f0000-0000-7000-8000-000000000201',
        sourceSlug: 'tencent-social',
        adapterKey: 'tencent.social',
        enabled: true,
      },
      {
        companyId: '018f0000-0000-7000-8000-000000000102',
        sourceId: '018f0000-0000-7000-8000-000000000202',
        sourceSlug: 'alibaba-campus',
        adapterKey: 'alibaba.campus',
        enabled: true,
      },
      {
        companyId: '018f0000-0000-7000-8000-000000000101',
        sourceId: '018f0000-0000-7000-8000-000000000211',
        sourceSlug: 'tencent-intern',
        adapterKey: 'tencent.intern',
        enabled: true,
      },
      {
        companyId: '018f0000-0000-7000-8000-000000000103',
        sourceId: '018f0000-0000-7000-8000-000000000203',
        sourceSlug: 'baidu-campus',
        adapterKey: 'baidu.campus',
        enabled: true,
      },
      {
        companyId: '018f0000-0000-7000-8000-000000000104',
        sourceId: '018f0000-0000-7000-8000-000000000204',
        sourceSlug: 'bytedance-social',
        adapterKey: 'bytedance.social',
        enabled: true,
      },
      {
        companyId: '018f0000-0000-7000-8000-000000000104',
        sourceId: '018f0000-0000-7000-8000-000000000213',
        sourceSlug: 'bytedance-campus',
        adapterKey: 'bytedance.campus',
        enabled: true,
      },
      {
        companyId: '018f0000-0000-7000-8000-000000000105',
        sourceId: '018f0000-0000-7000-8000-000000000205',
        sourceSlug: 'pinduoduo-intern',
        adapterKey: 'pinduoduo.intern',
        enabled: true,
      },
      {
        companyId: '018f0000-0000-7000-8000-000000000106',
        sourceId: '018f0000-0000-7000-8000-000000000206',
        sourceSlug: 'meituan-social',
        adapterKey: 'meituan.social',
        enabled: true,
      },
      {
        companyId: '018f0000-0000-7000-8000-000000000106',
        sourceId: '018f0000-0000-7000-8000-000000000212',
        sourceSlug: 'meituan-intern',
        adapterKey: 'meituan.intern',
        enabled: true,
      },
      {
        companyId: '018f0000-0000-7000-8000-000000000107',
        sourceId: '018f0000-0000-7000-8000-000000000207',
        sourceSlug: 'dewu-campus',
        adapterKey: 'dewu.campus',
        enabled: true,
      },
      {
        companyId: '018f0000-0000-7000-8000-000000000108',
        sourceId: '018f0000-0000-7000-8000-000000000208',
        sourceSlug: 'xiaohongshu-campus',
        adapterKey: 'xiaohongshu.campus',
        enabled: true,
      },
      {
        companyId: '018f0000-0000-7000-8000-000000000109',
        sourceId: '018f0000-0000-7000-8000-000000000209',
        sourceSlug: 'jd-intern',
        adapterKey: 'jd.intern',
        enabled: true,
      },
      {
        companyId: '018f0000-0000-7000-8000-000000000110',
        sourceId: '018f0000-0000-7000-8000-000000000210',
        sourceSlug: 'huawei-intern',
        adapterKey: 'huawei.intern',
        enabled: true,
      },
    ]);
    expect(
      firstPartyPhysicalSourceCatalog.slice(0, 13).map((record) => record.source.config),
    ).toEqual([
      { pageSize: 100 },
      {},
      { pageSize: 100 },
      {},
      {},
      {},
      { pageSize: 100 },
      { pageSize: 100 },
      { pageSize: 100 },
      {},
      { pageSize: 100 },
      { pageSize: 100 },
      {},
    ]);
  });

  it('defines exactly three logical channels for every company with variable physical sources', () => {
    expect(firstPartySourceCatalog).toHaveLength(45);
    expect(new Set(firstPartySourceCatalog.map((record) => record.company.slug)).size).toBe(15);
    expect(new Set(firstPartySourceCatalog.map((record) => record.channel.slug)).size).toBe(45);
    expect(new Set(firstPartySourceCatalog.map((record) => record.company.id)).size).toBe(15);
    expect(new Set(firstPartySourceCatalog.map((record) => record.channel.id)).size).toBe(45);
    const channelsByCompany = new Map<string, Set<string>>();
    for (const record of firstPartySourceCatalog) {
      const channels = channelsByCompany.get(record.company.slug) ?? new Set<string>();
      channels.add(record.channel.type);
      channelsByCompany.set(record.company.slug, channels);
      expect(record.channel.slug).toBe(`${record.company.slug}-${record.channel.type}`);
    }
    for (const channels of channelsByCompany.values()) {
      expect([...channels].sort()).toEqual(['campus', 'intern', 'social']);
    }
    expect(
      firstPartyPhysicalSourceCatalog
        .filter((record) => record.source.enabledByDefault)
        .map((record) => record.company.slug),
    ).toEqual([
      'tencent',
      'alibaba',
      'tencent',
      'baidu',
      'bytedance',
      'bytedance',
      'pinduoduo',
      'meituan',
      'meituan',
      'dewu',
      'xiaohongshu',
      'jd',
      'huawei',
      'xiaomi',
      'vivo',
      'oppo',
      'qihoo360',
      'netease',
      'alibaba',
      'alibaba',
      'baidu',
      'baidu',
      'bytedance',
      'pinduoduo',
      'meituan',
      'dewu',
      'dewu',
      'xiaohongshu',
      'xiaohongshu',
      'jd',
      'jd',
      'huawei',
      'huawei',
      'xiaomi',
      'xiaomi',
      'vivo',
      'vivo',
      'oppo',
      'oppo',
      'qihoo360',
      'qihoo360',
      'netease',
      'netease',
      'netease',
      'netease',
      'tencent',
    ]);
    for (const record of firstPartyPhysicalSourceCatalog) {
      expect(record.source.enabledByDefault).toBe(record.source.supportStatus === 'supported');
      expect(record.source.baseUrl).toMatch(/^https:\/\//);
    }
    expect(new Set(firstPartyPhysicalSourceCatalog.map((record) => record.source.id)).size).toBe(
      47,
    );
    expect(
      firstPartySourceCatalog
        .find((record) => record.company.slug === 'tencent' && record.channel.type === 'campus')
        ?.sources.map((source) => source.adapterKey),
    ).toEqual(['tencent.campus']);
    const neteaseCampus = firstPartySourceCatalog.find(
      (record) => record.company.slug === 'netease' && record.channel.type === 'campus',
    );
    expect(neteaseCampus?.sources.map((source) => source.slug)).toEqual([
      'netease-campus-internet',
      'netease-campus-games',
      'netease-campus-leihuo',
    ]);
  });

  it('registers adapters for configured sources while enablement remains gate-controlled', () => {
    const registry = new AdapterRegistry();
    registerFirstPartyAdapters(registry);
    expect(registry.keys()).toEqual(
      firstPartyPhysicalSourceCatalog
        .filter((record) => record.source.supportStatus !== 'blocked')
        .map((record) => record.source.adapterKey)
        .sort(),
    );
    for (const record of firstPartyPhysicalSourceCatalog.filter(
      (candidate) => candidate.source.supportStatus !== 'blocked',
    )) {
      expect(() => registry.resolve(record.source.adapterKey, record.source.config)).not.toThrow();
    }
  });

  it('registers the verified Tencent campus source instead of a placeholder', () => {
    const registry = new AdapterRegistry();
    registerFirstPartyAdapters(registry);
    const record = firstPartySourceCatalog.find(
      (candidate) => candidate.channel.slug === 'tencent-campus',
    );
    expect(record).toBeDefined();
    if (!record) return;
    expect(record.channel.enabledByDefault).toBe(true);
    expect(record.sources.map((source) => source.adapterKey)).toEqual(['tencent.campus']);
    expect(registry.keys()).toContain('tencent.campus');
  });

  it('marks independent social sources as social-only', () => {
    const socialSources = firstPartyPhysicalSourceCatalog.filter(
      (record) => record.channel.type === 'social',
    );
    expect(socialSources).toHaveLength(15);
    expect(socialSources.every((record) => record.source.recruitmentType === 'social')).toBe(true);
  });

  it('enables only new sources that passed their online support gate', () => {
    const newAdapterKeys = new Set([
      'xiaomi.intern',
      'vivo.social',
      'oppo.intern',
      'qihoo360.social',
      'netease.social',
    ]);
    expect(
      firstPartyPhysicalSourceCatalog
        .filter((record) => newAdapterKeys.has(record.source.adapterKey))
        .map((record) => [
          record.source.adapterKey,
          record.source.supportStatus,
          record.source.enabledByDefault,
        ]),
    ).toEqual([
      ['xiaomi.intern', 'supported', true],
      ['vivo.social', 'supported', true],
      ['oppo.intern', 'supported', true],
      ['qihoo360.social', 'supported', true],
      ['netease.social', 'supported', true],
    ]);
  });

  it('uses the campus entry for JD and Xiaohongshu campus sources', () => {
    expect(
      firstPartyPhysicalSourceCatalog
        .filter((record) => ['jd.campus', 'xiaohongshu.campus'].includes(record.source.adapterKey))
        .map((record) => [record.source.adapterKey, record.source.baseUrl]),
    ).toEqual([
      ['xiaohongshu.campus', 'https://job.xiaohongshu.com/campus/position'],
      ['jd.campus', 'https://campus.jd.com/#/jobs'],
    ]);
  });
});
