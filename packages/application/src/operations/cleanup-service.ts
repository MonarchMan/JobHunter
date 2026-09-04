import { createHash } from 'node:crypto';

/** 应用层使用的类型约束。 */
export type CleanupCandidateKind = 'orphan_file' | 'source_detail' | 'observation' | 'agent_run';

/** 应用层数据结构或端口契约。 */
export interface CleanupCandidate {
  readonly kind: CleanupCandidateKind;
  readonly id: string;
  readonly relativePath: string | null;
  readonly bytes: number;
  readonly createdAt: number;
}

/** 应用层数据结构或端口契约。 */
export interface CleanupRepository {
  listCandidates(cutoffs: {
    readonly sourceDetailsBefore: number;
    readonly observationsBefore: number;
    readonly agentRunsBefore: number;
  }): readonly CleanupCandidate[];
  listRegisteredArtifactPaths(): readonly string[];
  deleteCandidates(candidates: readonly CleanupCandidate[]): void;
}

/** 应用层数据结构或端口契约。 */
export interface CleanupFileStore {
  listArtifactFiles(): Promise<
    readonly {
      readonly relativePath: string;
      readonly bytes: number;
      readonly modifiedAt: number;
    }[]
  >;
  remove(relativePaths: readonly string[]): Promise<void>;
}

/** 应用层数据结构或端口契约。 */
export interface CleanupPolicy {
  readonly sourceDetailsDays: number;
  readonly observationsDays: number;
  readonly failedAgentRunsDays: number;
  readonly orphanSafetyWindowMs?: number;
}

/** 应用层数据结构或端口契约。 */
export interface CleanupOperationPlan {
  readonly kind: 'cleanup';
  readonly candidates: readonly CleanupCandidate[];
  readonly counts: Readonly<Record<CleanupCandidateKind, number>>;
  readonly bytes: number;
  readonly warnings: readonly string[];
  readonly plannedAt: number;
  readonly expiresAt: number;
  readonly confirmationToken: string;
}

const dayMs = 24 * 60 * 60 * 1_000;

/** 校验清理策略边界。 */
function validatePolicy(policy: CleanupPolicy): Required<CleanupPolicy> {
  for (const [key, value] of Object.entries({
    sourceDetailsDays: policy.sourceDetailsDays,
    observationsDays: policy.observationsDays,
    failedAgentRunsDays: policy.failedAgentRunsDays,
  })) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 3_650) {
      throw new TypeError(`Cleanup policy ${key} is invalid.`);
    }
  }
  const orphanSafetyWindowMs = policy.orphanSafetyWindowMs ?? dayMs;
  if (
    !Number.isSafeInteger(orphanSafetyWindowMs) ||
    orphanSafetyWindowMs < dayMs ||
    orphanSafetyWindowMs > 30 * dayMs
  ) {
    throw new TypeError('Cleanup orphan safety window must be between 24 hours and 30 days.');
  }
  return { ...policy, orphanSafetyWindowMs };
}

/** 按稳定键排序清理候选，保证确认令牌可复现。 */
function sorted(candidates: readonly CleanupCandidate[]): readonly CleanupCandidate[] {
  return candidates.toSorted(
    (left, right) => left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id),
  );
}

/** 应用层数据结构或端口契约。 */
function tokenFor(input: {
  readonly plannedAt: number;
  readonly expiresAt: number;
  readonly policy: Required<CleanupPolicy>;
  readonly candidates: readonly CleanupCandidate[];
}): string {
  const payload = Buffer.from(JSON.stringify(input), 'utf8').toString('base64url');
  const digest = createHash('sha256').update(payload, 'utf8').digest('hex');
  return `${payload}.${digest}`;
}

/** 执行应用层的解析、转换或编排辅助逻辑。 */
interface CleanupTokenPayload {
  readonly plannedAt: number;
  readonly expiresAt: number;
  readonly policy: Required<CleanupPolicy>;
  readonly candidates: readonly CleanupCandidate[];
}

/** 执行应用层的解析、转换或编排辅助逻辑。 */
function parseToken(token: string): CleanupTokenPayload {
  const separator = token.lastIndexOf('.');
  if (separator < 1) throw new TypeError('Cleanup confirmation token is invalid.');
  const payload = token.slice(0, separator);
  const digest = createHash('sha256').update(payload, 'utf8').digest('hex');
  if (token.slice(separator + 1) !== digest) {
    throw new TypeError('Cleanup confirmation token is invalid.');
  }
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as CleanupTokenPayload;
}

/** 生成并执行需显式确认的本地数据清理计划。 */
export class CleanupService {
  readonly #repository: CleanupRepository;
  readonly #files: CleanupFileStore;

  public constructor(input: {
    readonly repository: CleanupRepository;
    readonly files: CleanupFileStore;
  }) {
    this.#repository = input.repository;
    this.#files = input.files;
  }

  /** 生成当前清理候选和确认令牌。 */
  public async plan(
    policyInput: CleanupPolicy,
    options: { readonly now?: number; readonly tokenLifetimeMs?: number } = {},
  ): Promise<CleanupOperationPlan> {
    const policy = validatePolicy(policyInput);
    const plannedAt = options.now ?? Date.now();
    const lifetime = options.tokenLifetimeMs ?? 5 * 60_000;
    if (!Number.isSafeInteger(lifetime) || lifetime < 1_000 || lifetime > 30 * 60_000) {
      throw new TypeError('Cleanup confirmation lifetime is invalid.');
    }
    const candidates = await this.#candidates(policy, plannedAt);
    const expiresAt = plannedAt + lifetime;
    const confirmationToken = tokenFor({ plannedAt, expiresAt, policy, candidates });
    const counts = { orphan_file: 0, source_detail: 0, observation: 0, agent_run: 0 };
    for (const candidate of candidates) counts[candidate.kind] += 1;
    return {
      kind: 'cleanup',
      candidates,
      counts,
      bytes: candidates.reduce((total, candidate) => total + candidate.bytes, 0),
      warnings: ['清理不可撤销；请先创建并验证备份。'],
      plannedAt,
      expiresAt,
      confirmationToken,
    };
  }

  /** 校验确认令牌后执行清理。 */
  public async execute(
    // 1、解析计划令牌；2、重新查询并比对候选；3、删除数据库记录；4、清理文件。
    confirmationToken: string,
    options: { readonly now?: number } = {},
  ): Promise<{ readonly deleted: number; readonly bytes: number }> {
    const payload = parseToken(confirmationToken);
    if ((options.now ?? Date.now()) > payload.expiresAt) {
      throw new TypeError('Cleanup confirmation token is expired.');
    }
    const current = await this.#candidates(validatePolicy(payload.policy), payload.plannedAt);
    const currentByIdentity = new Map(
      current.map((candidate) => [`${candidate.kind}\u0000${candidate.id}`, candidate]),
    );
    const registered = new Set(this.#repository.listRegisteredArtifactPaths());
    for (const planned of payload.candidates) {
      const currentCandidate = currentByIdentity.get(`${planned.kind}\u0000${planned.id}`);
      if (currentCandidate && JSON.stringify(currentCandidate) !== JSON.stringify(planned)) {
        throw new TypeError('Cleanup candidates changed after the dry-run plan.');
      }
      if (
        planned.kind === 'orphan_file' &&
        !currentCandidate &&
        planned.relativePath &&
        registered.has(planned.relativePath)
      ) {
        throw new TypeError('Cleanup candidates changed after the dry-run plan.');
      }
    }
    const databaseCandidates = payload.candidates.filter(
      (candidate) => candidate.kind !== 'orphan_file',
    );
    this.#repository.deleteCandidates(databaseCandidates);
    await this.#files.remove(
      payload.candidates.flatMap((candidate) =>
        candidate.relativePath ? [candidate.relativePath] : [],
      ),
    );
    return {
      deleted: payload.candidates.length,
      bytes: payload.candidates.reduce((total, candidate) => total + candidate.bytes, 0),
    };
  }

  async #candidates(
    policy: Required<CleanupPolicy>,
    plannedAt: number,
  ): Promise<readonly CleanupCandidate[]> {
    const database = this.#repository.listCandidates({
      sourceDetailsBefore: plannedAt - policy.sourceDetailsDays * dayMs,
      observationsBefore: plannedAt - policy.observationsDays * dayMs,
      agentRunsBefore: plannedAt - policy.failedAgentRunsDays * dayMs,
    });
    const registered = new Set(this.#repository.listRegisteredArtifactPaths());
    const orphanFiles = (await this.#files.listArtifactFiles())
      .filter(
        (file) =>
          !registered.has(file.relativePath) &&
          file.modifiedAt <= plannedAt - policy.orphanSafetyWindowMs,
      )
      .map((file): CleanupCandidate => ({
        kind: 'orphan_file',
        id: file.relativePath,
        relativePath: file.relativePath,
        bytes: file.bytes,
        createdAt: file.modifiedAt,
      }));
    return sorted([...database, ...orphanFiles]);
  }
}
