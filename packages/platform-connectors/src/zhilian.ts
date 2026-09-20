import {
  PlatformError,
  type PlatformJobDetail,
  type PlatformSession,
  type PlatformBatch,
} from '@jobhunter/platform-core';
import { z } from 'zod';

const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
const text = z.string().trim().min(1).max(2_000);
const selectionSchema = z
  .object({ externalJobId: identifier, title: text, company: text })
  .strict();
const authSchema = z
  .object({
    at: z.string().min(1).max(8_192),
    rt: z.string().min(1).max(8_192),
    d: z.string().min(1).max(512),
  })
  .strict();
const envelopeSchema = z.object({ statusCode: z.number().int(), data: z.unknown().optional() });
const detailSchema = z.object({
  positionDetail: z.object({
    positionNumber: identifier,
    positionName: text,
    jobDesc: z.string().trim().min(1).max(200_000),
    positionWorkCity: text,
    positionWorkingExp: z.string().max(500),
    salary60: z.string().max(500),
    education: z.string().max(500),
  }),
  companyDetail: z.object({ companyNumber: identifier, companyName: text }),
});

/** 浏览器已展示且由用户选择的卡片；不以展示名称推测公司 ID。 */
export type ZhilianCampusSelection = z.infer<typeof selectionSchema>;

/** 解析已观察的无属性排版为纯文本；仅主站显式允许 div，校园边界保持不变。 */
export function campusDescription(html: string, allowDiv = false): string {
  // 1、未知实体和标签不能静默丢弃；有限标签栈同时验证成对闭合。
  if (/&(?:#\w+|\w+);/.test(html)) throw new PlatformError('parse_changed');
  const stack: { tag: 'p' | 'ol' | 'li' | 'div'; count: number }[] = [];
  let output = '';
  let hasText = false;
  for (const token of html.split(/(<[^>]*>)/g)) {
    if (!token.startsWith('<')) {
      hasText ||= token.trim().length > 0;
      output += token;
      continue;
    }
    // 2、br 不入栈；段落与列表之间明确换行，避免相邻文字粘连。
    if (/^<br\s*\/?\s*>$/i.test(token)) {
      output += '\n';
      continue;
    }
    const match = /^<(\/?)(p|ol|li|div)\s*>$/i.exec(token);
    const tag = match?.[2]?.toLowerCase();
    if (!match || (tag !== 'p' && tag !== 'ol' && tag !== 'li' && !(allowDiv && tag === 'div')))
      throw new PlatformError('parse_changed');
    if (match[1] === '/') {
      if (stack.pop()?.tag !== tag) throw new PlatformError('parse_changed');
      output += '\n';
      continue;
    }
    // 3、li 必须直属 ol，每个列表独立计数；禁止隐式闭合的畸形结构。
    const parent = stack.at(-1);
    if (tag === 'li') {
      if (parent?.tag !== 'ol') throw new PlatformError('parse_changed');
      parent.count += 1;
      output += `\n${String(parent.count)}. `;
    } else {
      if (parent?.tag === 'p' || parent?.tag === 'ol') throw new PlatformError('parse_changed');
      output += '\n';
    }
    stack.push({ tag, count: 0 });
  }
  if (stack.length || !hasText) throw new PlatformError('parse_changed');
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

/** 核对官网详情与已展示卡片，仅返回统一职位事实，不返回账号或 HR 信息。 */
export function parseZhilianCampusDetail(
  selection: ZhilianCampusSelection,
  raw: unknown,
): PlatformJobDetail {
  // 1、边界校验只报告分类，绝不输出 Zod 原始输入或平台响应。
  const selected = selectionSchema.safeParse(selection);
  const envelope = envelopeSchema.safeParse(raw);
  if (!selected.success || !envelope.success) throw new PlatformError('parse_changed');
  if (envelope.data.statusCode !== 200)
    throw new PlatformError(
      envelope.data.statusCode === 2024 ? 'access_blocked' : 'upstream_error',
      envelope.data.statusCode,
    );
  const parsed = detailSchema.safeParse(envelope.data.data);
  if (!parsed.success) throw new PlatformError('parse_changed');
  const { positionDetail: job, companyDetail: company } = parsed.data;
  // 2、公司编号来自详情，名称与卡片一致才接受；不兼容的别名必须另行核实。
  if (
    job.positionNumber !== selected.data.externalJobId ||
    job.positionName !== selected.data.title ||
    company.companyName !== selected.data.company
  )
    throw new PlatformError('parse_changed');
  // 3、已观察的段落／列表转换为纯文本，未知格式继续拒绝，不放宽身份校验。
  const description = campusDescription(job.jobDesc);
  return {
    externalJobId: job.positionNumber,
    externalCompanyId: company.companyNumber,
    title: job.positionName,
    company: company.companyName,
    city: job.positionWorkCity,
    salary: job.salary60,
    experience: job.positionWorkingExp,
    education: job.education,
    sourceUrl: `https://xiaoyuan.zhaopin.com/job/${job.positionNumber}`,
    description,
  };
}

/** 单条选中职位的实验会话，不是推荐分页适配器；每次连接最多一次 HTTP。 */
export class ZhilianCampusSelectionSession implements PlatformSession {
  #auth: z.infer<typeof authSchema> | null;
  readonly #selection: ZhilianCampusSelection;
  readonly #fetch: typeof fetch;
  readonly #abort = new AbortController();
  #detail: PlatformJobDetail | null = null;
  #consumed = false;
  #busy = false;

  public constructor(input: {
    readonly selection: ZhilianCampusSelection;
    readonly auth: z.infer<typeof authSchema>;
    readonly fetch?: typeof fetch;
  }) {
    const auth = authSchema.safeParse(input.auth);
    const selection = selectionSchema.safeParse(input.selection);
    if (!auth.success || !selection.success) throw new PlatformError('session_unavailable');
    this.#auth = auth.data;
    this.#selection = selection.data;
    this.#fetch = input.fetch ?? fetch;
  }

  /** 先用详情补齐可靠公司身份，再交付单条候选；末尾仅表示选中集合已耗尽。 */
  public async readNext(callerSignal: AbortSignal): Promise<PlatformBatch> {
    if (callerSignal.aborted || this.#busy || this.#abort.signal.aborted)
      throw new PlatformError('session_unavailable');
    if (this.#consumed) return { candidates: [], hasMore: false };
    if (!this.#auth) throw new PlatformError('session_unavailable');
    this.#busy = true;
    const signal = AbortSignal.any([callerSignal, this.#abort.signal, AbortSignal.timeout(20_000)]);
    try {
      // 1、固定官网只读端点，认证仅进请求头／正文，不允许 Cookie 导出或任意 URL。
      signal.throwIfAborted();
      const { at, rt, d } = this.#auth;
      const response = await this.#fetch(
        'https://cgate.zhaopin.com/positionbusiness/exposure/getPositionDetail',
        {
          method: 'POST',
          redirect: 'manual',
          signal,
          headers: {
            'Content-Type': 'application/json',
            'x-zp-at': at,
            'x-zp-rt': rt,
            'x-zp-platform': '14',
            'x-zp-business-system': '40',
            Origin: 'https://xiaoyuan.zhaopin.com',
            Referer: 'https://xiaoyuan.zhaopin.com/',
          },
          body: JSON.stringify({
            number: this.#selection.externalJobId,
            identity: 1,
            at,
            rt,
            d,
            channel: 'xiaoyuan',
            platform: '14',
            version: '0.0.0',
          }),
        },
      );
      // 2、状态、大小和协议均受限；不跟随重定向，不执行 HTML 或校验脚本。
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
          if (size > 2 * 1_024 * 1_024) throw new PlatformError('parse_changed');
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
      let raw: unknown;
      try {
        raw = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
      } catch {
        throw new PlatformError('parse_changed');
      }
      // 3、只保留已校验事实，成功后立即释放认证字段；详情动作不再发请求。
      this.#detail = parseZhilianCampusDetail(this.#selection, raw);
      signal.throwIfAborted();
      this.#auth = null;
      this.#consumed = true;
      const { description: _description, ...candidate } = this.#detail;
      void _description;
      return { candidates: [candidate], hasMore: false };
    } catch (error) {
      this.disconnect();
      throw error instanceof PlatformError ? error : new PlatformError('network_error');
    } finally {
      this.#busy = false;
    }
  }

  /** 只消费本次已验证的同一职位正文；不触发重复上游读取。 */
  public readDetail(externalJobId: string, signal: AbortSignal): Promise<PlatformJobDetail> {
    // 1、断开、取消、并发或未选中职位不得消费内存结果。
    if (
      signal.aborted ||
      this.#abort.signal.aborted ||
      this.#busy ||
      !this.#detail ||
      this.#detail.externalJobId !== externalJobId
    )
      return Promise.reject(new PlatformError('session_unavailable'));
    return Promise.resolve(this.#detail);
  }

  /** 失败或断开后释放认证与结果并中止在途请求，不自动重试。 */
  public disconnect(): void {
    this.#abort.abort();
    this.#auth = null;
    this.#detail = null;
  }
}
