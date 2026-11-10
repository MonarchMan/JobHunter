import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { UsageService } from '../src/usage/service.js';
import { SqliteUsageRepository } from '../src/persistence/usage-repository.js';
import { modelBillingSchema } from '../src/contracts/model-usage.js';
import { SqliteModelRequestRepository } from '../src/persistence/model-request-repository.js';

const now = Date.parse('2026-11-04T12:00:00Z');
/** 合成请求包含缓存输入，避免使用真实用户账单数据。 */
function billing(requestedAt = now, overrides: Record<string, unknown> = {}): unknown {
  return modelBillingSchema.parse({
    model: 'fixture-model',
    requestedAt,
    inputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 80,
    cacheWriteTokens: 10,
    uncachedInputTokens: 10,
    inputCostMicros: 1,
    outputCostMicros: 2,
    cacheReadCostMicros: 3,
    cacheWriteCostMicros: 4,
    totalCostMicros: 10,
    currency: 'USD',
    pricingVersion: 'fixture',
    period: 'fixed',
    precision: 'reported',
    rates: null,
    ...overrides,
  });
}
/** 最小 SQLite 表复现生产 JSON 查询，不需要网络或用户数据库。 */
function fixture(): {
  db: Database.Database;
  service: UsageService;
  insert: (id: string, calls: unknown, status?: string) => void;
} {
  const db = new Database(':memory:');
  db.exec(
    'CREATE TABLE agent_runs(id TEXT PRIMARY KEY, agent_key TEXT, status TEXT, model_usage_json TEXT, started_at INTEGER, input_tokens INTEGER, output_tokens INTEGER)',
  );
  db.exec(
    readFileSync(
      new URL('../migrations/legacy/0048_model_request_ledger.sql', import.meta.url),
      'utf8',
    ),
  );
  db.exec('ALTER TABLE model_requests ADD COLUMN ai_message_id TEXT');
  // 独立账本的请求诊断归通用事件表，最小夹具也保留其唯一性约束。
  db.exec(
    'CREATE TABLE events(id TEXT PRIMARY KEY,stream_type TEXT NOT NULL,stream_id TEXT NOT NULL,sequence_no INTEGER NOT NULL,event_type TEXT NOT NULL,payload_json TEXT NOT NULL,occurred_at INTEGER NOT NULL,UNIQUE(stream_type,stream_id,sequence_no))',
  );
  const ledger = new SqliteModelRequestRepository(db);
  return {
    db,
    service: new UsageService(new SqliteUsageRepository(db)),
    insert: (id, calls, status = 'succeeded') => {
      db.prepare('INSERT INTO agent_runs VALUES (?, ?, ?, ?, 100, 20)').run(
        id,
        'fixture-agent',
        status,
        now - 40 * 86400000,
      );
      if (Array.isArray(calls))
        calls.forEach((call: unknown, index: number) => {
          ledger.save(id, {
            id: `${id}:${String(index)}`,
            state: 'completed',
            billing: modelBillingSchema.parse(call),
          });
        });
    },
  };
}

describe('usage ledger (USG-002, USG-003, USG-004)', () => {
  it('uses request timestamps, Shanghai boundaries, normalized tokens and currency isolation', () => {
    const { db, service, insert } = fixture();
    try {
      const midnight = Date.parse('2026-11-03T16:00:00Z');
      insert('old-run-retried', [
        billing(midnight - 1),
        billing(midnight),
        billing(now),
        billing(now + 1),
        billing(now, { currency: 'CNY' }),
      ]);
      const report = service.query({}, now);
      expect(report.start).toBe(midnight);
      expect(report.total).toMatchObject({
        requests: 3,
        tokens: 360,
        costByCurrency: { USD: 20, CNY: 10 },
        cacheRead: 240,
        cacheInput: 300,
      });
      expect(report.buckets).toHaveLength(21);
      expect(report.buckets[0]?.total.requests).toBe(1);
      expect(report.buckets[1]?.total.requests).toBe(0);
      expect(report.total.cost).toBeCloseTo(20 + 10 / 7.2);
      expect(service.query({ currency: 'CNY' }, now).total).toMatchObject({
        requests: 3,
        cost: 154,
      });
      expect(service.query({ currency: 'USD' }, now).total).toMatchObject({
        requests: 3,
        costByCurrency: { USD: 20, CNY: 10 },
      });
      expect(report.groups[0]?.total.costByCurrency).toEqual({ USD: 20, CNY: 10 });
      expect(report.groups[0]?.total.cost).toBeCloseTo(report.total.cost ?? 0);
      expect(new UsageService(new SqliteUsageRepository(db), 10).query({}, now).total.cost).toBe(
        21,
      );
      for (const rate of [0, -1, NaN, Infinity]) {
        expect(() => new UsageService(new SqliteUsageRepository(db), rate)).toThrow(TypeError);
      }
      expect(
        report.buckets.reduce((sum, bucket) => sum + (bucket.total.costByCurrency.CNY ?? 0), 0),
      ).toBe(10);
      expect(service.query({ range: '7d' }, now).buckets).toHaveLength(7);
    } finally {
      db.close();
    }
  });
  it('keeps unknown usage and failed runs, filters before aggregating and paginates only logs', () => {
    const { db, service, insert } = fixture();
    try {
      insert(
        'retry',
        Array.from({ length: 27 }, () => billing()),
        'failed',
      );
      insert('unknown', [
        billing(now, {
          model: 'unknown',
          inputTokens: null,
          outputTokens: null,
          cacheReadTokens: null,
          cacheWriteTokens: null,
          uncachedInputTokens: null,
          totalCostMicros: null,
          precision: 'unpriced',
        }),
      ]);
      const report = service.query({ status: 'failed', page: 2 }, now);
      expect(report.total.requests).toBe(27);
      expect(report.calls).toHaveLength(7);
      expect(report.groups[0]?.total.requests).toBe(27);
      expect(report.buckets.reduce((n, b) => n + b.total.requests, 0)).toBe(27);
      const unknown = service.query({ model: 'unknown' }, now);
      expect(unknown.total).toMatchObject({
        unpriced: 1,
        unknownTokens: 1,
        unknownCache: 1,
        cacheInput: 0,
      });
      expect(service.query({ model: 'absent', page: 999 }, now)).toMatchObject({
        pages: 1,
        filters: { page: 1 },
        total: { requests: 0 },
      });
      insert('legacy', null);
      db.prepare('UPDATE agent_runs SET started_at = ? WHERE id = ?').run(now, 'legacy');
      expect(service.query({}, now).legacyRuns).toBe(1);
    } finally {
      db.close();
    }
  });
  it('excludes network failures consistently while preserving the ledger and unknown historical status', () => {
    const { db, service, insert } = fixture();
    try {
      insert('metrics', [
        billing(now, {
          provider: 'one.test',
          statusCode: 200,
          outputTokens: 100,
          durationMs: 2000,
          firstTokenMs: 1000,
        }),
        billing(now, {
          provider: 'one.test',
          statusCode: 200,
          outputTokens: 300,
          durationMs: 9000,
          firstTokenMs: 3000,
        }),
        billing(now, {
          provider: 'one.test',
          statusCode: 200,
          outputTokens: 10,
          durationMs: 20100,
          firstTokenMs: 20000,
        }),
        billing(now, {
          provider: 'two.test',
          model: 'other',
          statusCode: null,
          transportError: 'network',
        }),
        billing(now, { provider: 'two.test', application: 'Other' }),
        billing(now - 4 * 86400000, {
          provider: 'network-only.test',
          model: 'network-200',
          statusCode: 200,
          transportError: 'network',
        }),
      ]);
      const report = service.query({}, now);
      expect(report.total).toMatchObject({
        successful: 3,
        requests: 4,
        knownStatus: 3,
        firstTokenMs: 3000,
        uncached: 40,
        cacheWrite: 40,
        cost: 40,
      });
      expect(report.models).not.toContain('other');
      expect(report.calls.every((call) => call.transportError !== 'network')).toBe(true);
      expect(report.buckets.reduce((sum, bucket) => sum + bucket.total.requests, 0)).toBe(4);
      expect(
        db
          .prepare("SELECT count(*) FROM model_requests WHERE transport_error='network'")
          .pluck()
          .get(),
      ).toBe(2);
      expect(report.total.outputTokensPerSecond).toBeCloseTo(400 / 7);
      expect(report.providerGroups.map((group) => group.provider)).toEqual([
        'one.test',
        'two.test',
      ]);
      expect(service.query({ provider: 'one.test' }, now).models).toEqual(['fixture-model']);
      expect(service.query({ application: 'Other' }, now).total.requests).toBe(1);
      expect(service.query({ range: '14d' }, now).buckets).toHaveLength(14);
      expect(service.query({ range: '24h' }, now).start).toBe(now - 86400000);
      expect(service.query({ range: 'all' }, now).start).toBe(Date.parse('2026-11-03T16:00:00Z'));
      expect(report.total).not.toHaveProperty('firstTokens');
    } finally {
      db.close();
    }
  });
});
