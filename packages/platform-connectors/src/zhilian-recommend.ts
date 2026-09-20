import { setTimeout as delay } from 'node:timers/promises';
import {
  PlatformError,
  type PlatformSession,
  type PlatformBatch,
  type PlatformCandidate,
  type PlatformJobDetail,
} from '@jobhunter/platform-core';
import { z } from 'zod';
import { ZhilianCampusSelectionSession } from './zhilian.js';

const endpoint =
  'https://cgate.zhaopin.com/positionbusiness/searchRecommendCampus/searchRecommendCampusPcSubject';
const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[\w-]+$/);
const short = z.string().max(2_000);
const bodySchema = z
  .object({
    at: z.string().min(1).max(8_192),
    rt: z.string().min(1).max(8_192),
    d: z.string().min(1).max(512),
    identity: z.literal('1'),
    filterMinSalary: z.literal(1),
    resumeNumber: z.string().min(1).max(512),
    subjectType: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    eventScenario: short,
    pageIndex: z.number().int().min(1).max(20),
    pageSize: z.literal(20),
    browsedJobNumbers: z.string().max(20_000),
    clickedJobNumbers: z.array(id).max(500),
    S_SOU_JD_JOB_LEVEL3: short.optional(),
    S_SOU_WORK_CITY: short.optional(),
    S_SOU_XY_POSITION_TYPE: short.optional(),
    channel: z.literal('xiaoyuan'),
    platform: z.literal('14'),
    version: z.literal('0.0.0'),
  })
  .strict();
const rowSchema = z.object({
  number: id,
  name: short.min(1),
  companyNumber: z.union([id, z.literal('')]),
  companyName: short.min(1),
  workCity: short.min(1),
  salary60: short,
  education: short,
  workingExp: short,
  campusJobDetail: z.object({ companyName: short, companyNumber: short }).nullable().optional(),
});
const envelope = z.object({ statusCode: z.number().int(), data: z.unknown().optional() });
const batchSchema = z.object({
  isEndPage: z.union([z.literal(0), z.literal(1)]),
  list: z.array(rowSchema).max(100),
});
const headerKeys = new Set([
  'sec-ch-ua-platform',
  'x-zp-business-system',
  'referer',
  'x-zp-rt',
  'x-zp-at',
  'sec-ch-ua',
  'sec-ch-ua-mobile',
  'x-zp-platform',
  'x-zp-actionid',
  'user-agent',
  'accept',
  'content-type',
  'accept-language',
  'origin',
  'priority',
  'sec-fetch-dest',
  'sec-fetch-mode',
  'sec-fetch-site',
]);

/** 智联校园推荐的已观察模板；原始字段仅留会话内存，不进入任务载荷。 */
export interface ZhilianCampusRequestTemplate {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/** 推荐与详情均实时 HTTP；列表不是来源完整快照，失败立即冻结。 */
export class ZhilianCampusHttpSession implements PlatformSession {
  #body: z.infer<typeof bodySchema> | null;
  #headers: Record<string, string> = {};
  #url: string | null;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #abort = new AbortController();
  readonly #candidates = new Map<string, PlatformCandidate>();
  readonly #seen = new Set<string>();
  #page = 0;
  #hasMore = true;
  #busy = false;
  #lastRequestAt: number | null = null;

  public constructor(input: {
    readonly template: ZhilianCampusRequestTemplate;
    readonly fetch?: typeof fetch;
    readonly now?: () => number;
  }) {
    // 1、观察模板也视为外部输入；不得注入任意代理端点或未审核请求字段。
    try {
      const url = new URL(input.template.url);
      if (
        url.origin + url.pathname !== endpoint ||
        url.username ||
        url.password ||
        url.hash ||
        [...url.searchParams.keys()].some(
          (k) => !['x-zp-page-request-id', 'x-zp-client-id'].includes(k),
        ) ||
        url.href.length > 8192
      )
        throw new Error('Invalid URL');
      this.#url = url.href;
      const parsed = bodySchema.safeParse(JSON.parse(input.template.body));
      if (!parsed.success || parsed.data.pageIndex !== 1) throw new Error('Invalid body');
      this.#body = parsed.data;
      for (const [key, value] of Object.entries(input.template.headers)) {
        const name = key.toLowerCase();
        if (
          name === 'cookie' ||
          name.startsWith(':') ||
          ['content-length', 'accept-encoding', 'connection', 'host'].includes(name)
        )
          continue;
        if (
          typeof value !== 'string' ||
          !headerKeys.has(name) ||
          /[\r\n]/.test(value) ||
          value.length > 16_384
        )
          throw new Error('Invalid header');
        this.#headers[name] = value;
      }
      if (
        this.#headers['x-zp-at'] !== this.#body.at ||
        this.#headers['x-zp-rt'] !== this.#body.rt ||
        this.#headers['x-zp-platform'] !== '14' ||
        this.#headers['x-zp-business-system'] !== '40'
      )
        throw new Error('Inconsistent context');
      this.#headers.origin = 'https://xiaoyuan.zhaopin.com';
      this.#headers.referer = 'https://xiaoyuan.zhaopin.com/';
      this.#headers['content-type'] = 'application/json';
    } catch {
      throw new PlatformError('parse_changed');
    }
    this.#fetch = input.fetch ?? fetch;
    this.#now = input.now ?? Date.now;
  }

  /** 一次一页；不自动翻页，不把重复页或矛盾空页当作末页。 */
  public readNext(signal: AbortSignal): Promise<PlatformBatch> {
    return this.#run(signal, async (activeSignal) => {
      if (!this.#body || !this.#url || this.#page >= 20)
        throw new PlatformError('session_unavailable');
      if (!this.#hasMore) return { candidates: [], hasMore: false };
      // 1、保持已观察筛选与重复 URL 参数，仅推进页码。
      const raw = await this.#list({ ...this.#body, pageIndex: this.#page + 1 }, activeSignal);
      const outer = envelope.safeParse(raw);
      if (!outer.success) throw new PlatformError('parse_changed');
      if (outer.data.statusCode !== 200)
        throw new PlatformError(
          outer.data.statusCode === 2024 ? 'access_blocked' : 'upstream_error',
          outer.data.statusCode,
        );
      const parsed = batchSchema.safeParse(outer.data.data);
      if (!parsed.success) throw new PlatformError('parse_changed');
      const rows = parsed.data.list;
      if (
        new Set(rows.map((r) => r.number)).size !== rows.length ||
        (rows.length === 0 && parsed.data.isEndPage === 0) ||
        (rows.length > 0 && rows.every((r) => this.#seen.has(r.number)))
      )
        throw new PlatformError('parse_changed');
      // 2、公司编号缺失的已知条目排除计数；展示名称优先校园子公司，但编号必须一致。
      const candidates: PlatformCandidate[] = [];
      let skippedMissingCompanyId = 0;
      for (const row of rows) {
        this.#seen.add(row.number);
        if (!row.companyNumber) {
          skippedMissingCompanyId++;
          continue;
        }
        const campus = row.campusJobDetail;
        if (campus?.companyNumber && campus.companyNumber !== row.companyNumber)
          throw new PlatformError('parse_changed');
        const candidate: PlatformCandidate = {
          externalJobId: row.number,
          externalCompanyId: row.companyNumber,
          title: row.name,
          company: campus && campus.companyName.length > 0 ? campus.companyName : row.companyName,
          city: row.workCity,
          salary: row.salary60,
          experience: row.workingExp,
          education: row.education,
          sourceUrl: `https://xiaoyuan.zhaopin.com/job/${row.number}`,
        };
        if (!this.#candidates.has(row.number)) candidates.push(candidate);
        this.#candidates.set(row.number, candidate);
      }
      this.#page++;
      this.#hasMore = parsed.data.isEndPage === 0;
      return { candidates, hasMore: this.#hasMore, skippedMissingCompanyId };
    });
  }

  /** 只读取当前推荐工作集中的详情，真实 HTTP 成功后再核对公司编号。 */
  public readDetail(externalJobId: string, signal: AbortSignal): Promise<PlatformJobDetail> {
    return this.#run(signal, async (activeSignal) => {
      const candidate = this.#candidates.get(externalJobId);
      if (!candidate || !this.#body) throw new PlatformError('session_unavailable');
      // 1、复用已验证的详情协议，不消费列表摘要或预先重放的响应。
      const { at, rt, d } = this.#body;
      const detailSession = new ZhilianCampusSelectionSession({
        selection: { externalJobId, title: candidate.title, company: candidate.company },
        auth: { at, rt, d },
        fetch: this.#fetch,
      });
      try {
        await detailSession.readNext(activeSignal);
        const detail = await detailSession.readDetail(externalJobId, activeSignal);
        if (detail.externalCompanyId !== candidate.externalCompanyId)
          throw new PlatformError('parse_changed');
        return detail;
      } finally {
        detailSession.disconnect();
      }
    });
  }

  /** 释放本轮 HTTP 上下文，不拥有或关闭外部借用的 CDP 连接。 */
  public disconnect(): void {
    this.#abort.abort();
    this.#body = null;
    this.#url = null;
    this.#headers = {};
    this.#candidates.clear();
    this.#seen.clear();
  }

  /** 串行实验请求，5 秒是用户确认的实验策略，不宣称为平台风控要求。 */
  async #run<T>(caller: AbortSignal, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.#busy || this.#abort.signal.aborted || caller.aborted)
      throw new PlatformError('session_unavailable');
    this.#busy = true;
    const signal = AbortSignal.any([caller, this.#abort.signal]);
    try {
      const remaining =
        this.#lastRequestAt === null ? 0 : Math.max(0, 5_000 - (this.#now() - this.#lastRequestAt));
      if (remaining) await delay(remaining, undefined, { signal });
      signal.throwIfAborted();
      this.#lastRequestAt = this.#now();
      const result = await work(signal);
      signal.throwIfAborted();
      return result;
    } catch (error) {
      this.disconnect();
      throw error instanceof PlatformError ? error : new PlatformError('network_error');
    } finally {
      this.#busy = false;
    }
  }

  /** 固定端点的有界 JSON 读取，跳转／HTML／超大响应均不继续请求。 */
  async #list(body: z.infer<typeof bodySchema>, caller: AbortSignal): Promise<unknown> {
    const signal = AbortSignal.any([caller, this.#abort.signal, AbortSignal.timeout(20_000)]);
    if (!this.#url) throw new PlatformError('session_unavailable');
    const response = await this.#fetch(this.#url, {
      method: 'POST',
      redirect: 'manual',
      signal,
      headers: this.#headers,
      body: JSON.stringify(body),
    });
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new PlatformError(
        response.status === 429
          ? 'rate_limited'
          : response.status === 403
            ? 'access_blocked'
            : 'upstream_error',
      );
    }
    const reader = response.body?.getReader();
    if (!reader) throw new PlatformError('parse_changed');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        signal.throwIfAborted();
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2 * 1024 * 1024) throw new PlatformError('parse_changed');
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch {
      throw new PlatformError('parse_changed');
    }
  }
}
