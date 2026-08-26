import { AdapterRegistry } from '@jobhunter/source-core';
import { describe, expect, it } from 'vitest';
import { firstPartySourceCatalog, registerFirstPartyAdapters } from '../src/index.js';

describe('first-party source catalog', () => {
  it('defines ten companies with independent channel sources, support and enablement', () => {
    expect(firstPartySourceCatalog).toHaveLength(13);
    expect(new Set(firstPartySourceCatalog.map((record) => record.company.slug)).size).toBe(10);
    expect(new Set(firstPartySourceCatalog.map((record) => record.source.slug)).size).toBe(13);
    expect(new Set(firstPartySourceCatalog.map((record) => record.company.id)).size).toBe(10);
    expect(new Set(firstPartySourceCatalog.map((record) => record.source.id)).size).toBe(13);
    expect(
      firstPartySourceCatalog
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
    ]);
    for (const record of firstPartySourceCatalog) {
      expect(record.source.enabledByDefault).toBe(record.source.supportStatus === 'supported');
      expect(record.source.baseUrl).toMatch(/^https:\/\//);
    }
  });

  it('registers adapters for configured sources while enablement remains gate-controlled', () => {
    const registry = new AdapterRegistry();
    registerFirstPartyAdapters(registry);
    expect(registry.keys()).toEqual([
      'alibaba.campus',
      'baidu.campus',
      'bytedance.campus',
      'bytedance.social',
      'dewu.campus',
      'huawei.campus',
      'jd.campus',
      'meituan.intern',
      'meituan.social',
      'pinduoduo.intern',
      'tencent.intern',
      'tencent.social',
      'xiaohongshu.campus',
    ]);
  });
});
