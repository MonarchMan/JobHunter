import { AdapterRegistry } from '@jobhunter/source-core';
import { describe, expect, it } from 'vitest';
import { firstPartySourceCatalog, registerFirstPartyAdapters } from '../src/index.js';

describe('first-party source catalog', () => {
  it('defines ten unique companies and sources with independent support and enablement', () => {
    expect(firstPartySourceCatalog).toHaveLength(10);
    expect(new Set(firstPartySourceCatalog.map((record) => record.company.slug)).size).toBe(10);
    expect(new Set(firstPartySourceCatalog.map((record) => record.source.slug)).size).toBe(10);
    expect(new Set(firstPartySourceCatalog.map((record) => record.company.id)).size).toBe(10);
    expect(new Set(firstPartySourceCatalog.map((record) => record.source.id)).size).toBe(10);
    expect(
      firstPartySourceCatalog
        .filter((record) => record.source.enabledByDefault)
        .map((record) => record.company.slug),
    ).toEqual(['tencent']);
    for (const record of firstPartySourceCatalog) {
      expect(record.source.enabledByDefault).toBe(record.source.supportStatus === 'supported');
      expect(record.source.baseUrl).toMatch(/^https:\/\//);
    }
  });

  it('registers only adapters that passed the supported gate', () => {
    const registry = new AdapterRegistry();
    registerFirstPartyAdapters(registry);
    expect(registry.keys()).toEqual(['tencent.social']);
  });
});
