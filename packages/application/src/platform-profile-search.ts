import {
  PlatformError,
  type PlatformBatch,
  type PlatformJobDetail,
  type PlatformSession,
  type PlatformSessionProvider,
} from '@jobhunter/platform-core';
import { canonicalJobFamilies } from '@jobhunter/domain';
import type { CandidateProfileRepository } from './ports/profiles.js';

/** 默认资料的搜索计划；词集只在连接时计算一次。 */
export interface PlatformProfileSearchPlan {
  readonly profileVersionId: string;
  readonly keywords: readonly string[];
}

/** 从默认第一份资料取得具体意向岗位，不用大类或细分岗位代替原词。 */
export function platformProfileSearchPlan(
  profiles: Pick<CandidateProfileRepository, 'listProfiles' | 'getCurrentVersion'>,
): PlatformProfileSearchPlan {
  // 1、资料仓储按创建时间、ID 排序；没有资料或版本时不得退回推荐流。
  const first = profiles.listProfiles()[0];
  const version = first ? profiles.getCurrentVersion(first.id) : null;
  if (!version) throw new PlatformError('session_unavailable', null, 'profile_required');
  // 2、只规范空白和大小写去重，保留用户填写的具体词供官网搜索。
  const keywords: string[] = [];
  const seen = new Set<string>();
  const families = new Set<string>(canonicalJobFamilies);
  for (const role of version.effective.intendedRoles ?? []) {
    const keyword = role.trim().replace(/\s+/gu, ' ');
    if (!keyword) continue;
    if (keyword.length > 200) throw new PlatformError('session_unavailable', null, 'query_invalid');
    // 2.a、新意向字段也须填写具体职位，不改动原有职位类别字段。
    if (families.has(keyword))
      throw new PlatformError('session_unavailable', null, 'query_too_broad');
    const key = keyword.normalize('NFKC').toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    keywords.push(keyword);
    // 2.b、单次动作会逐词建立会话并读取一批，限制词数防止意外放大请求。
    if (keywords.length > 10) throw new PlatformError('session_unavailable', null, 'query_invalid');
  }
  if (keywords.length === 0) throw new PlatformError('session_unavailable', null, 'query_required');
  return { profileVersionId: version.id, keywords };
}

/** 多个词级会话共同组成一个平台逻辑连接，职位身份在提供方内去重。 */
class PlatformProfileSearchSession implements PlatformSession {
  readonly #sessions: readonly { keyword: string; session: PlatformSession }[];
  readonly #ended: boolean[];
  readonly #current = new Map<string, PlatformSession>();

  public constructor(sessions: readonly { keyword: string; session: PlatformSession }[]) {
    this.#sessions = sessions;
    this.#ended = sessions.map(() => false);
  }

  /** 任一词级连接断开都使整个逻辑连接失效。 */
  public onDisconnected(listener: () => void): () => void {
    const releases = this.#sessions.map(({ session }) => session.onDisconnected?.(listener));
    return () => {
      for (const release of releases) release?.();
    };
  }

  /** 显式读取每个未结束词的一批；跨词重复只保留第一条稳定身份。 */
  public async readNext(signal: AbortSignal): Promise<PlatformBatch> {
    // 1、上一批详情在应用层处理完毕后，才允许覆盖职位到词级会话的映射。
    this.#current.clear();
    const candidates: PlatformBatch['candidates'][number][] = [];
    const byId = new Map<string, PlatformBatch['candidates'][number]>();
    const batches: NonNullable<PlatformBatch['searchBatches']>[number][] = [];
    let skipped = 0;
    for (const [index, { keyword, session }] of this.#sessions.entries()) {
      signal.throwIfAborted();
      if (this.#ended[index]) {
        batches.push({ keyword, count: 0, hasMore: false });
        continue;
      }
      // 2、各词游标独立推进；失败不跳过后续词或伪装整批完成。
      const batch = await session.readNext(signal);
      this.#ended[index] = !batch.hasMore;
      batches.push({ keyword, count: batch.candidates.length, hasMore: batch.hasMore });
      skipped += batch.skippedMissingCompanyId ?? 0;
      const withinBatch = new Set<string>();
      for (const candidate of batch.candidates) {
        // 2.a、单词批次自身重复仍是协议异常，只有跨词重叠才允许合并。
        if (withinBatch.has(candidate.externalJobId)) throw new PlatformError('parse_changed');
        withinBatch.add(candidate.externalJobId);
        const previous = byId.get(candidate.externalJobId);
        if (previous) {
          if (previous.externalCompanyId !== candidate.externalCompanyId)
            throw new PlatformError('parse_changed', null, 'duplicate_identity');
          // 2.b、浏览器批次保留待处理集合；重复详情不请求，但须释放其分页门槛。
          session.discardDetail?.(candidate.externalJobId);
          continue;
        }
        candidates.push(candidate);
        byId.set(candidate.externalJobId, candidate);
        this.#current.set(candidate.externalJobId, session);
      }
    }
    return {
      candidates,
      hasMore: this.#ended.some((ended) => !ended),
      searchBatches: batches,
      skippedMissingCompanyId: skipped,
    };
  }

  /** 只向本批首次出现该职位的词级会话请求完整详情。 */
  public readDetail(externalJobId: string, signal: AbortSignal): Promise<PlatformJobDetail> {
    const session = this.#current.get(externalJobId);
    if (!session) throw new PlatformError('session_unavailable');
    return session.readDetail(externalJobId, signal);
  }

  /** 释放全部词级连接，不保留浏览器认证或候选工作集。 */
  public disconnect(): void {
    for (const { session } of this.#sessions) session.disconnect();
    this.#current.clear();
  }
}

/** 逐词建立真实搜索会话；任何初始化失败都清理已创建的会话。 */
export async function connectPlatformProfileSearch(
  provider: PlatformSessionProvider,
  plan: PlatformProfileSearchPlan,
  input: Parameters<PlatformSessionProvider['connect']>[0],
  signal: AbortSignal,
): Promise<PlatformSession> {
  const sessions: { keyword: string; session: PlatformSession }[] = [];
  try {
    // 1、连接按资料词序串行建立，每个词固定自己的查询与分页状态。
    for (const keyword of plan.keywords) {
      signal.throwIfAborted();
      const session = await provider.connect({ ...input, search: { keyword, city: '' } }, signal);
      sessions.push({ keyword, session });
    }
    return new PlatformProfileSearchSession(sessions);
  } catch (error) {
    // 2、失败不得留下部分可用的后台页或借用旧推荐会话。
    for (const { session } of sessions) session.disconnect();
    throw error;
  }
}
