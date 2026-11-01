import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  contentHash,
  DomainError,
  parseId,
  SystemIdGenerator,
  utcInstant,
} from '@jobhunter/common/domain';
const IDS = {
  company: '018f0000-0000-7000-8000-000000000001',
  source: '018f0000-0000-7000-8000-000000000002',
  job: '018f0000-0000-7000-8000-000000000003',
  revision: '018f0000-0000-7000-8000-000000000004',
  profileVersion: '018f0000-0000-7000-8000-000000000005',
  enrichment: '018f0000-0000-7000-8000-000000000006',
  ruleset: '018f0000-0000-7000-8000-000000000007',
  match: '018f0000-0000-7000-8000-000000000008',
  agentRun: '018f0000-0000-7000-8000-000000000009',
} as const;

describe('domain primitives', () => {
  it('generates RFC 9562 UUIDv7 IDs with the configured timestamp', () => {
    const timestamp = 1_700_000_000_123;
    const generated = new SystemIdGenerator({
      now: () => timestamp,
      random: () => Uint8Array.from([0xff, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
    }).generate();

    expect(parseId(generated, 'Task')).toBe(generated);
    expect(generated.at(14)).toBe('7');
    expect(['8', '9', 'a', 'b']).toContain(generated.at(19));
    expect(Number.parseInt(generated.replaceAll('-', '').slice(0, 12), 16)).toBe(timestamp);
  });

  it('validates branded UUIDv7 IDs and stable UTC instants', () => {
    expect(parseId(IDS.job, 'Job')).toBe(IDS.job);
    expect(() => parseId('not-an-id', 'Job')).toThrow(DomainError);
    expect(utcInstant(new Date('2026-01-01T00:00:00.000Z'))).toBe(1_767_225_600_000);
  });

  it('canonicalizes object key order and rejects non-finite values', () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe(canonicalJson({ a: 1, b: 2 }));
    expect(contentHash({ b: 2, a: 1 })).toBe(contentHash({ a: 1, b: 2 }));
    expect(() => canonicalJson({ invalid: Number.NaN })).toThrow(DomainError);
  });
});
