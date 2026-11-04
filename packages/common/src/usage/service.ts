import { z } from 'zod';
import type { ModelBilling } from '../contracts/model-usage.js';

/** 单个持久化请求；状态仅表示所属 Agent 运行，不代表 HTTP 请求结果。 */
export interface UsageCall extends ModelBilling {
  id: string;
  agent: string;
  status: string;
  requestState?: 'running' | 'completed';
}
/** 只读仓储端口，时间范围左闭右开，不读取模型输入输出。 */
export interface UsageRepository {
  read(start: number, end: number): { calls: UsageCall[]; legacyRuns: number };
}
/** 外部筛选边界；币种明确分开，避免隐式汇率改变历史费用。 */
export const usageFilterSchema = z.object({
  range: z.enum(['today', '24h', '7d', '14d', '30d', 'all']).catch('today'),
  application: z.string().max(100).catch(''),
  model: z.string().max(200).catch(''),
  provider: z.string().max(300).catch(''),
  statusCode: z
    .string()
    .regex(/^(?:[1-5][0-9]{2}|unknown)?$/)
    .catch(''),
  status: z.enum(['', 'running', 'succeeded', 'failed', 'cancelled']).catch(''),
  currency: z.enum(['USD', 'CNY']).catch('USD'),
  page: z.coerce.number().int().positive().max(1000000).catch(1),
});
/** 请求聚合；金额和 Tokens 的未知计数随结果返回，不冒充零消费。 */
export interface UsageTotals {
  requests: number;
  tokens: number;
  cost: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheInput: number;
  unknownTokens: number;
  unpriced: number;
  unknownCache: number;
  successful: number;
  knownStatus: number;
  uncached: number;
  cacheWrite: number;
  unknownCacheWrite: number;
  unknownOutput: number;
  unknownUncached: number;
  firstTokenMs: number | null;
  outputTokensPerSecond: number | null;
}
/** 分位数与加权速度的中间状态仅存在服务端，不发送逐请求样本到浏览器。 */
interface Accumulator extends UsageTotals {
  firstTokens: number[];
  generationTokens: number;
  generationMs: number;
}
/** 创建空聚合，也用于没有请求的时间桶。 */
function empty(): Accumulator {
  return {
    requests: 0,
    tokens: 0,
    cost: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheInput: 0,
    unknownTokens: 0,
    unpriced: 0,
    unknownCache: 0,
    successful: 0,
    knownStatus: 0,
    uncached: 0,
    cacheWrite: 0,
    unknownCacheWrite: 0,
    unknownOutput: 0,
    unknownUncached: 0,
    firstTokenMs: null,
    outputTokensPerSecond: null,
    firstTokens: [],
    generationTokens: 0,
    generationMs: 0,
  };
}
/** 输入包含缓存读写；金额只累加已有快照，不重新定价。 */
function add(total: Accumulator, call: UsageCall): void {
  total.requests++;
  if (call.requestState !== 'running' && (call.statusCode != null || call.transportError)) {
    total.knownStatus++;
    if (
      call.statusCode != null &&
      call.statusCode >= 200 &&
      call.statusCode < 300 &&
      !call.transportError
    ) {
      total.successful++;
      if (call.firstTokenMs != null) {
        total.firstTokens.push(call.firstTokenMs);
        const generation = (call.durationMs ?? 0) - call.firstTokenMs;
        if ((call.outputTokens ?? 0) >= 100 && generation > 0) {
          total.generationTokens += call.outputTokens ?? 0;
          total.generationMs += generation;
        }
      }
    }
  }
  total.uncached += call.uncachedInputTokens ?? 0;
  if (call.uncachedInputTokens === null) total.unknownUncached++;
  if (call.outputTokens === null) total.unknownOutput++;
  total.cacheWrite += call.cacheWriteTokens ?? 0;
  if (call.cacheWriteTokens === null) total.unknownCacheWrite++;
  total.input += call.inputTokens ?? 0;
  total.output += call.outputTokens ?? 0;
  total.tokens += (call.inputTokens ?? 0) + (call.outputTokens ?? 0);
  if (call.inputTokens === null || call.outputTokens === null) total.unknownTokens++;
  if (call.totalCostMicros === null) total.unpriced++;
  else total.cost += call.totalCostMicros;
  if (call.cacheReadTokens === null || call.inputTokens === null) total.unknownCache++;
  else {
    total.cacheRead += call.cacheReadTokens;
    total.cacheInput += call.inputTokens;
  }
}
/** 去除中间样本；首字取中位数，速度按时间加权，避免短请求放大均值。 */
function summarize(value: Accumulator): UsageTotals {
  const { firstTokens, generationTokens, generationMs, ...total } = value;
  firstTokens.sort((a, b) => a - b);
  const middle = Math.floor(firstTokens.length / 2);
  total.firstTokenMs = firstTokens.length
    ? ((firstTokens[middle] ?? 0) + (firstTokens[Math.floor((firstTokens.length - 1) / 2)] ?? 0)) /
      2
    : null;
  total.outputTokensPerSecond = generationMs ? (generationTokens * 1000) / generationMs : null;
  return total;
}
/** 页面只读结果；仅当前页请求传往浏览器，总计不受分页影响。 */
export interface UsageReport {
  filters: z.infer<typeof usageFilterSchema>;
  start: number;
  end: number;
  legacyRuns: number;
  total: UsageTotals;
  models: string[];
  providers: string[];
  applications: string[];
  prices: Pick<ModelBilling, 'model' | 'currency' | 'pricingVersion' | 'period' | 'rates'>[];
  statusCodes: number[];
  providerGroups: { provider: string; total: UsageTotals }[];
  groups: { model: string; total: UsageTotals }[];
  buckets: { at: number; total: UsageTotals }[];
  calls: UsageCall[];
  pages: number;
}
/** 聚合模型请求账本；用例仅依赖仓储端口，不加载数据库运行时。 */
export class UsageService {
  public constructor(private readonly repository: UsageRepository) {}
  public query(input: unknown, now = Date.now()): UsageReport {
    // 1、按上海自然日定义窗口，不能依赖服务器所在时区。
    const filters = usageFilterSchema.parse(input);
    const day = 86400000,
      offset = 8 * 3600000;
    const midnight = Math.floor((now + offset) / day) * day - offset;
    const days =
      filters.range === '7d' ? 7 : filters.range === '14d' ? 14 : filters.range === '30d' ? 30 : 1;
    const end = now + 1;
    let start =
      filters.range === 'all'
        ? 0
        : filters.range === '24h'
          ? now - day
          : midnight - (days - 1) * day;
    const snapshot = this.repository.read(start, end);
    if (filters.range === 'all') {
      const earliest = snapshot.calls.reduce((at, call) => Math.min(at, call.requestedAt), now);
      start = Math.floor((earliest + offset) / day) * day - offset;
    }
    const applications = [
      ...new Set(snapshot.calls.map((call) => call.application ?? 'JobHunter')),
    ].sort();
    const scoped = snapshot.calls.filter(
      (call) => !filters.application || (call.application ?? 'JobHunter') === filters.application,
    );
    const models = [
      ...new Set(
        scoped
          .filter((call) => !filters.provider || call.provider === filters.provider)
          .map((call) => call.model),
      ),
    ].sort();
    const providers = [
      ...new Set(scoped.map((call) => call.provider).filter((value): value is string => !!value)),
    ].sort();
    const statusCodes = [
      ...new Set(
        snapshot.calls
          .map((call) => call.statusCode)
          .filter((value): value is number => value != null),
      ),
    ].sort();
    const calls = scoped
      .filter(
        (call) =>
          call.currency === filters.currency &&
          (!filters.model || call.model === filters.model) &&
          (!filters.provider || call.provider === filters.provider) &&
          (!filters.statusCode ||
            (filters.statusCode === 'unknown'
              ? call.statusCode == null
              : call.statusCode === Number(filters.statusCode))) &&
          (!filters.status || call.status === filters.status),
      )
      .sort((a, b) => b.requestedAt - a.requestedAt || a.id.localeCompare(b.id));
    // 2、同一筛选集生成指标、分组和补零趋势；请求不重复加运行级汇总。
    const interval =
      filters.range === 'today' || filters.range === '24h'
        ? 3600000
        : day * Math.max(1, Math.ceil((now - start) / day / 366));
    const buckets = Array.from({ length: Math.floor((now - start) / interval) + 1 }, (_, i) => ({
      at: start + i * interval,
      total: empty(),
    }));
    const total = empty(),
      groups = new Map<string, Accumulator>();
    const providerGroups = new Map<string, Accumulator>();
    const prices = new Map<string, UsageReport['prices'][number]>();
    for (const call of calls) {
      const price = {
        model: call.model,
        currency: call.currency,
        pricingVersion: call.pricingVersion,
        period: call.period,
        rates: call.rates,
      };
      prices.set(JSON.stringify(price), price);
      add(total, call);
      const group = groups.get(call.model) ?? empty();
      add(group, call);
      groups.set(call.model, group);
      const provider = call.provider ?? '—';
      const providerTotal = providerGroups.get(provider) ?? empty();
      add(providerTotal, call);
      providerGroups.set(provider, providerTotal);
      const bucket = buckets[Math.floor((call.requestedAt - start) / interval)];
      if (bucket) add(bucket.total, call);
    }
    // 3、仅日志分页；超出范围回到最后一页，空结果仍保留一页。
    const pages = Math.max(1, Math.ceil(calls.length / 20));
    filters.page = Math.min(filters.page, pages);
    return {
      filters,
      start,
      end,
      legacyRuns: snapshot.legacyRuns,
      total: summarize(total),
      models,
      providers,
      applications,
      prices: [...prices.values()],
      statusCodes,
      providerGroups: [...providerGroups]
        .map(([provider, value]) => ({ provider, total: summarize(value) }))
        .sort((a, b) => b.total.requests - a.total.requests),
      buckets: buckets.map((bucket) => ({ at: bucket.at, total: summarize(bucket.total) })),
      groups: [...groups]
        .map(([model, value]) => ({ model, total: summarize(value) }))
        .sort((a, b) => b.total.requests - a.total.requests),
      calls: calls.slice((filters.page - 1) * 20, filters.page * 20),
      pages,
    };
  }
}
