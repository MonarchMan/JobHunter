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
    expect(firstPartySourceCatalog).toHaveLength(60);
    expect(new Set(firstPartySourceCatalog.map((record) => record.company.slug)).size).toBe(20);
    expect(new Set(firstPartySourceCatalog.map((record) => record.channel.slug)).size).toBe(60);
    expect(new Set(firstPartySourceCatalog.map((record) => record.company.id)).size).toBe(20);
    expect(new Set(firstPartySourceCatalog.map((record) => record.channel.id)).size).toBe(60);
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
      'bilibili',
      'kuaishou',
      'kuaishou',
      'kuaishou',
      'kuaishou',
      'didi',
      'didi',
      'didi',
      'ctrip',
      'ctrip',
      'ctrip',
      'mihoyo',
      'mihoyo',
      'mihoyo',
    ]);
    for (const record of firstPartyPhysicalSourceCatalog) {
      expect(record.source.enabledByDefault).toBe(record.source.supportStatus === 'supported');
      expect(record.source.baseUrl).toMatch(/^https:\/\//);
    }
    expect(new Set(firstPartyPhysicalSourceCatalog.map((record) => record.source.id)).size).toBe(
      62,
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

  it('only registers verified wave-two physical sources, without placeholders (SWT-006)', () => {
    const targets = new Set(['kuaishou', 'bilibili', 'didi', 'ctrip', 'mihoyo']);
    const channels = firstPartySourceCatalog.filter((record) => targets.has(record.company.slug));
    expect(channels).toHaveLength(15);
    for (const record of channels) {
      if (record.company.slug === 'ctrip' || record.company.slug === 'mihoyo') {
        expect(record.sources).toHaveLength(1);
        expect(record.sources[0]).toMatchObject({
          adapterKey: `${record.company.slug}.${record.channel.type}`,
          supportStatus: 'supported',
          coverageRole: 'required',
          enabledByDefault: true,
        });
        expect(record.channel.enabledByDefault).toBe(record.channel.type === 'intern');
        continue;
      }
      if (record.company.slug === 'kuaishou') {
        expect(record.sources).toHaveLength(record.channel.type === 'intern' ? 2 : 1);
        expect(
          record.sources.every(
            (source) => source.supportStatus === 'supported' && source.coverageRole === 'required',
          ),
        ).toBe(true);
        expect(record.channel.enabledByDefault).toBe(record.channel.type === 'intern');
        continue;
      }
      if (record.company.slug === 'didi') {
        expect(record.sources).toHaveLength(record.channel.type === 'campus' ? 2 : 1);
        for (const source of record.sources) {
          expect(source.coverageRole).toBe(
            source.adapterKey === 'didi.campus.elite' ? 'supplemental' : 'required',
          );
          expect(source.supportStatus).toBe(
            source.adapterKey === 'didi.campus.elite' ? 'experimental' : 'supported',
          );
        }
        continue;
      }
      if (record.channel.slug === 'bilibili-social') {
        expect(record.sources).toHaveLength(1);
        expect(record.sources[0]).toMatchObject({
          id: '018f0000-0000-7000-8000-000000000249',
          adapterKey: 'bilibili.social',
          supportStatus: 'supported',
          enabledByDefault: true,
          config: { pageSize: 50 },
        });
        continue;
      }
      expect(record.sources).toEqual([]);
      expect(record.channel.enabledByDefault).toBe(false);
      expect(record.channel.supportNote).toBeTruthy();
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
    expect(record.channel.enabledByDefault).toBe(false);
    expect(record.sources.map((source) => source.adapterKey)).toEqual(['tencent.campus']);
    expect(registry.keys()).toContain('tencent.campus');
  });

  it('marks independent social sources as social-only', () => {
    const socialSources = firstPartyPhysicalSourceCatalog.filter(
      (record) => record.channel.type === 'social',
    );
    expect(socialSources).toHaveLength(20);
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
