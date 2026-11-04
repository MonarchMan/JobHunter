import type { SqliteDatabaseHandle } from '@jobhunter/common/persistence/connection';
import { SqliteModelRequestRepository } from '@jobhunter/common/persistence/model-request-repository';
/** 只给隔离浏览器夹具填入合成账单，原运行级汇总保持不变。 */
export function seedUsageFixture(client: SqliteDatabaseHandle['client'], runId: string): void {
  const now = Date.now();
  const midnight = Math.floor((now + 8 * 3600000) / 86400000) * 86400000 - 8 * 3600000;
  const calls = Array.from({ length: 28 }, (_, i) => ({
    model: 'usage-fixture-model',
    application: 'JobHunter',
    provider: 'api.example.test',
    statusCode: 200,
    durationMs: 5000,
    firstTokenMs: 1000,
    outputTokensPerSecond: 50,
    requestedAt: midnight + Math.floor(((now - midnight) * i) / 28),
    inputTokens: 1000,
    outputTokens: 200,
    cacheReadTokens: 800,
    cacheWriteTokens: 0,
    uncachedInputTokens: 200,
    inputCostMicros: 1000,
    outputCostMicros: 1000,
    cacheReadCostMicros: 1000,
    cacheWriteCostMicros: 0,
    totalCostMicros: 3000,
    currency: 'USD' as const,
    pricingVersion: 'fixture',
    precision: 'reported' as const,
    period: 'fixed' as const,
    rates: { input: 5000000, output: 5000000, cacheRead: 1250000, cacheWrite: null },
  }));
  const ledger = new SqliteModelRequestRepository(client);
  calls.forEach((billing, index) => {
    ledger.save(runId, { id: `fixture:${String(index)}`, state: 'completed', billing });
  });
}
