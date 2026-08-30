import {
  communityQuestionFingerprint,
  communityResearchPromptVersion,
  communityResearchSchemaVersion,
  contentHash,
  experienceResearchBriefSchema,
  parseId,
  researchRequestFingerprint,
  utcInstant,
  type Clock,
  type ExperienceResearchBrief,
  type IdGenerator,
  type TaskId,
} from '@jobhunter/domain';
import type { ArtifactStore } from '../ports/artifact-store.js';
import type { ExternalResearchExecutorKey } from '../ports/external-research.js';
import {
  InterviewTaskPublicationConflictError,
  type InterviewTaskPublisher,
} from '../ports/interview-task-publisher.js';
import type {
  CommunityExperienceFilter,
  CommunityInterviewExperienceRecord,
  CommunityInterviewQuestionRecord,
  ExperienceResearchDetail,
  ExperienceResearchRequestSummary,
  InterviewResearchRepository,
} from '../ports/interview-research.js';
import type { EnqueueTaskResult, TaskRecord } from '../tasks/model.js';
import type { TaskService } from '../tasks/task-service.js';
import { communityResearchJsonSchema, renderCommunityResearchPrompt } from './research-prompt.js';
import { normalizeCommunityResearchBundle } from './research-normalization.js';

const maximumBundleBytes = 2 * 1024 * 1024;
const maximumPromptBytes = 512 * 1024;
const maximumSchemaBytes = 512 * 1024;

function normalizeAcceptedFilter(filter: CommunityExperienceFilter): CommunityExperienceFilter {
  const normalized: { company?: string; role?: string; stage?: string } = {};
  for (const key of ['company', 'role', 'stage'] as const) {
    const value = filter[key];
    if (value === undefined) continue;
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed.length > 200) {
      throw new TypeError(`Community experience ${key} filter is invalid.`);
    }
    normalized[key] = trimmed;
  }
  return normalized;
}
const bundleImportLeaseMilliseconds = 5 * 60 * 1_000;

function researchFileId(kind: 'prompt' | 'schema', fingerprint: string): string {
  return contentHash({ fingerprint, kind, scope: 'experience-research-file' });
}

function bundleFileId(requestId: string): string {
  return contentHash({ kind: 'bundle', requestId, scope: 'experience-research-file' });
}

function stagingBundleFileId(requestId: string, claimToken: string): string {
  return contentHash({ claimToken, kind: 'bundle-staging', requestId });
}

export class ExperienceResearchNotFoundError extends Error {
  public constructor() {
    super('Experience research request does not exist.');
    this.name = 'ExperienceResearchNotFoundError';
  }
}

export class ExperienceResearchConflictError extends Error {
  public constructor(message = 'Experience research request changed.') {
    super(message);
    this.name = 'ExperienceResearchConflictError';
  }
}

export class ExperienceResearchBundleError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ExperienceResearchBundleError';
  }
}

export class ExperienceResearchArtifactError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ExperienceResearchArtifactError';
  }
}

export class ExperienceResearchService {
  readonly #repository: InterviewResearchRepository;
  readonly #artifacts: ArtifactStore;
  readonly #tasks: TaskService | null;
  readonly #taskPublisher: InterviewTaskPublisher | null;
  readonly #clock: Clock;
  readonly #ids: IdGenerator;

  public constructor(input: {
    readonly repository: InterviewResearchRepository;
    readonly artifacts: ArtifactStore;
    readonly clock: Clock;
    readonly ids: IdGenerator;
    readonly tasks?: TaskService;
    readonly taskPublisher?: InterviewTaskPublisher;
  }) {
    this.#repository = input.repository;
    this.#artifacts = input.artifacts;
    this.#tasks = input.tasks ?? null;
    this.#taskPublisher = input.taskPublisher ?? null;
    this.#clock = input.clock;
    this.#ids = input.ids;
  }

  public listRequests(): readonly ExperienceResearchRequestSummary[] {
    return this.#repository.listRequests().map((request) => {
      const task = request.currentTaskId ? this.#tasks?.get(request.currentTaskId) : null;
      return {
        request,
        currentTask: task
          ? { id: task.id, status: task.status, errorCategory: task.errorCategory }
          : null,
      };
    });
  }

  public listAccepted(
    filter: CommunityExperienceFilter = {},
  ): ReturnType<InterviewResearchRepository['listAccepted']> {
    return this.#repository.listAccepted(normalizeAcceptedFilter(filter));
  }

  public get(requestIdValue: string): ExperienceResearchDetail {
    const detail = this.#repository.getRequest(
      parseId(requestIdValue, 'ExperienceResearchRequest'),
    );
    if (!detail) throw new ExperienceResearchNotFoundError();
    return detail;
  }

  public async create(briefValue: ExperienceResearchBrief): Promise<{
    readonly detail: ExperienceResearchDetail;
    readonly deduplicated: boolean;
  }> {
    const brief = experienceResearchBriefSchema.parse(briefValue);
    const baseFingerprint = researchRequestFingerprint(brief);
    const related = this.#repository
      .listRequests()
      .filter((request) => researchRequestFingerprint(request.brief) === baseFingerprint);
    for (const request of related) {
      if ((request.bundleFileVersionNo ?? 0) >= 5) continue;
      const detail = this.#repository.getRequest(request.id);
      if (!detail) continue;
      const accepted = detail.experiences.some(
        (experience) => experience.reviewStatus === 'accepted',
      );
      if (!accepted) return { detail, deduplicated: true };
    }
    const generation = related.length + 1;
    const fingerprint =
      generation === 1
        ? baseFingerprint
        : contentHash({ baseFingerprint, generation, kind: 'experience-research-request' });
    const concurrent = this.#repository.findByFingerprint(fingerprint);
    if (concurrent) return { detail: concurrent, deduplicated: true };
    const now = this.#clock.now();
    const requestId = parseId(this.#ids.generate(), 'ExperienceResearchRequest');
    const prompt = renderCommunityResearchPrompt(brief, fingerprint);
    const schema = communityResearchJsonSchema();
    const promptFileId = researchFileId('prompt', fingerprint);
    const schemaFileId = researchFileId('schema', fingerprint);
    const promptFile = await this.#artifacts.put({
      id: promptFileId,
      kind: 'interview_research',
      name: `${requestId}-prompt.md`,
      mediaType: 'text/markdown; charset=utf-8',
      content: new TextEncoder().encode(prompt),
      createdAt: now,
      logicalFile: 'new',
    });
    const schemaFile = await this.#artifacts.put({
      id: schemaFileId,
      kind: 'interview_research',
      name: `${requestId}-schema.json`,
      mediaType: 'application/schema+json',
      content: new TextEncoder().encode(JSON.stringify(schema, null, 2)),
      createdAt: now,
      logicalFile: 'new',
    });
    const detail = this.#repository.createRequest({
      id: requestId,
      brief,
      requestFingerprint: fingerprint,
      promptVersion: communityResearchPromptVersion,
      schemaVersion: communityResearchSchemaVersion,
      promptFileId: promptFile.id,
      promptFileVersionNo: promptFile.versionNo,
      schemaFileId: schemaFile.id,
      schemaFileVersionNo: schemaFile.versionNo,
      bundleFileId: null,
      bundleFileVersionNo: null,
      currentTaskId: null,
      state: 'ready',
      revision: 0,
      createdAt: now,
      updatedAt: now,
    });
    return { detail, deduplicated: detail.request.id !== requestId };
  }

  public async prompt(requestIdValue: string, signal?: AbortSignal): Promise<string> {
    const detail = this.get(requestIdValue);
    let bytes: Uint8Array;
    try {
      bytes = (
        await this.#artifacts.read({
          id: detail.request.promptFileId,
          versionNo: detail.request.promptFileVersionNo,
          kind: 'interview_research',
          maximumBytes: maximumPromptBytes,
          ...(signal ? { signal } : {}),
        })
      ).content;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      throw new ExperienceResearchArtifactError('Frozen research prompt is unavailable.', {
        cause: error,
      });
    }
    try {
      const prompt = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (!prompt.trim()) throw new TypeError('Frozen research prompt is empty.');
      return prompt;
    } catch (error) {
      throw new ExperienceResearchArtifactError('Frozen research prompt is invalid.', {
        cause: error,
      });
    }
  }

  public async schema(
    requestIdValue: string,
    signal?: AbortSignal,
  ): Promise<Readonly<Record<string, unknown>>> {
    const detail = this.get(requestIdValue);
    let bytes: Uint8Array;
    try {
      bytes = (
        await this.#artifacts.read({
          id: detail.request.schemaFileId,
          versionNo: detail.request.schemaFileVersionNo,
          kind: 'interview_research',
          maximumBytes: maximumSchemaBytes,
          ...(signal ? { signal } : {}),
        })
      ).content;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      throw new ExperienceResearchArtifactError('Frozen research schema is unavailable.', {
        cause: error,
      });
    }
    try {
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError('Frozen research schema must be a JSON object.');
      }
      return value as Readonly<Record<string, unknown>>;
    } catch (error) {
      throw new ExperienceResearchArtifactError('Frozen research schema is invalid.', {
        cause: error,
      });
    }
  }

  public enqueueExecution(input: {
    readonly requestId: string;
    readonly executorKey: ExternalResearchExecutorKey;
    readonly idempotencyToken: string;
  }): { readonly task: TaskRecord; readonly deduplicated: boolean } {
    if (!this.#tasks || !this.#taskPublisher) {
      throw new TypeError('Research execution task service is unavailable.');
    }
    const detail = this.get(input.requestId);
    const allCandidatesRejected =
      detail.experiences.length > 0 &&
      detail.experiences.every((experience) => experience.reviewStatus === 'rejected');
    const canReplaceRejectedBundle =
      detail.request.state === 'completed' &&
      allCandidatesRejected &&
      (detail.request.bundleFileVersionNo ?? 0) < 5;
    if (detail.request.state !== 'ready' && !canReplaceRejectedBundle) {
      throw new ExperienceResearchConflictError('Research request is not ready for execution.');
    }
    const token = input.idempotencyToken.trim();
    if (token.length < 8 || token.length > 200)
      throw new TypeError('Idempotency token is invalid.');
    let result: EnqueueTaskResult;
    try {
      result = this.#taskPublisher.publishExperienceResearch({
        command: {
          taskType: 'interview.experience-research.execute',
          payload: {
            requestId: detail.request.id,
            requestFingerprint: detail.request.requestFingerprint,
            expectedRevision: detail.request.revision,
            executorKey: input.executorKey,
          },
          idempotencyKey: `interview.research:${detail.request.id}:${input.executorKey}:${token}`,
        },
        requestId: detail.request.id,
        expectedRevision: detail.request.revision,
        now: this.#clock.now(),
      });
    } catch (error) {
      if (error instanceof InterviewTaskPublicationConflictError) {
        throw new ExperienceResearchConflictError('另一个研究任务仍在收尾，请稍后重试。');
      }
      throw error;
    }
    return { task: result.task, deduplicated: result.kind !== 'enqueued' };
  }

  public async importBundle(input: {
    readonly requestId: string;
    readonly expectedRevision: number;
    readonly bytes: Uint8Array;
    readonly taskId?: TaskId;
    readonly signal?: AbortSignal;
  }): Promise<ExperienceResearchDetail> {
    input.signal?.throwIfAborted();
    if (input.bytes.byteLength === 0 || input.bytes.byteLength > maximumBundleBytes) {
      throw new ExperienceResearchBundleError('研究包必须非空且不超过 2 MiB。');
    }
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(input.bytes);
    } catch {
      throw new ExperienceResearchBundleError('研究包必须使用 UTF-8 编码。');
    }
    let value: unknown;
    try {
      value = JSON.parse(text) as unknown;
    } catch {
      throw new ExperienceResearchBundleError('研究包不是有效 JSON。');
    }
    const requestId = parseId(input.requestId, 'ExperienceResearchRequest');
    const taskId = input.taskId === undefined ? undefined : parseId(input.taskId, 'Task');
    const current = this.#repository.getRequest(requestId);
    if (!current) throw new ExperienceResearchNotFoundError();
    if (current.request.schemaVersion !== communityResearchSchemaVersion) {
      throw new ExperienceResearchBundleError('当前版本不支持该研究请求的 Bundle Schema。');
    }
    if (current.request.revision !== input.expectedRevision) {
      throw new ExperienceResearchConflictError();
    }
    if ((current.request.bundleFileVersionNo ?? 0) >= 5) {
      throw new ExperienceResearchConflictError('该研究请求已保留 5 个有效 Bundle 版本。');
    }
    let bundle;
    try {
      bundle = normalizeCommunityResearchBundle({
        value,
        brief: current.request.brief,
        expectedFingerprint: current.request.requestFingerprint,
      });
    } catch (error) {
      throw new ExperienceResearchBundleError(
        error instanceof Error ? error.message : '研究包校验失败。',
      );
    }
    const canonicalBundleFileId = current.request.bundleFileId ?? bundleFileId(requestId);
    const sources = new Map(bundle.sources.map((source) => [source.url, source]));
    const experiences: CommunityInterviewExperienceRecord[] = [];
    const questions: CommunityInterviewQuestionRecord[] = [];
    bundle.experiences.forEach((candidate, experienceIndex) => {
      const source = sources.get(candidate.sourceUrl);
      if (!source) throw new ExperienceResearchBundleError('研究来源在规范化后缺失。');
      const experienceId = parseId(this.#ids.generate(), 'InterviewExperience');
      const topics = [...new Set(candidate.questions.flatMap((question) => question.topics))];
      experiences.push({
        id: experienceId,
        fileId: canonicalBundleFileId,
        sequenceNo: experienceIndex + 1,
        researchRequestId: requestId,
        reviewStatus: 'needs_review',
        company: candidate.company,
        role: candidate.role,
        stage: candidate.stage,
        occurredOn: candidate.occurredAt?.slice(0, 10) ?? null,
        tags: topics,
        notes: null,
        sourceUrl: candidate.sourceUrl,
        sourceTitle: source.title,
        sourcePublishedAt: source.publishedAt,
        sourceRetrievedAt: source.retrievedAt,
        verificationStatus: 'unverified',
      });
      candidate.questions.forEach((question, questionIndex) => {
        questions.push({
          id: parseId(this.#ids.generate(), 'InterviewQuestionEntry'),
          experienceId,
          sequenceNo: questionIndex + 1,
          question: question.text,
          answerExcerpt: question.answerExcerpt,
          topics: question.topics,
          evidenceExcerpt: question.evidenceExcerpt,
          questionFingerprint: communityQuestionFingerprint(question.text),
        });
      });
    });
    const claimToken = this.#ids.generate();
    const stagingFileId = stagingBundleFileId(requestId, claimToken);
    const now = this.#clock.now();
    input.signal?.throwIfAborted();
    if (
      !this.#repository.claimBundleImport({
        requestId,
        expectedRevision: input.expectedRevision,
        ...(taskId === undefined ? {} : { taskId }),
        claimToken,
        stagingFileId,
        now,
        staleBefore: utcInstant(Math.max(0, now - bundleImportLeaseMilliseconds)),
      })
    ) {
      throw new ExperienceResearchConflictError();
    }

    let completed = false;
    try {
      input.signal?.throwIfAborted();
      const staged = await this.#artifacts.put({
        id: stagingFileId,
        kind: 'interview_research',
        name: `${requestId}-bundle-pending.json`,
        mediaType: 'application/json',
        content: input.bytes,
        createdAt: now,
        logicalFile: 'new',
      });
      input.signal?.throwIfAborted();
      const replaced = this.#repository.replaceCandidates({
        requestId,
        expectedRevision: input.expectedRevision,
        ...(taskId === undefined ? {} : { taskId }),
        claimToken,
        bundleFileId: canonicalBundleFileId,
        stagingFileId: staged.id,
        stagingFileVersionNo: staged.versionNo,
        stagingEntityId: staged.entityId,
        experiences,
        questions,
        warnings: bundle.warnings,
        now,
      });
      if (!replaced) throw new ExperienceResearchConflictError();
      completed = true;
      return replaced;
    } finally {
      if (!completed) {
        this.#repository.abandonBundleImport({ requestId, claimToken, stagingFileId });
      }
    }
  }

  public review(input: {
    readonly requestId: string;
    readonly experienceId: string;
    readonly expectedRevision: number;
    readonly decision: 'accept' | 'reject';
  }): ExperienceResearchDetail {
    const result = this.#repository.reviewCandidate({
      requestId: parseId(input.requestId, 'ExperienceResearchRequest'),
      experienceId: parseId(input.experienceId, 'InterviewExperience'),
      expectedRevision: input.expectedRevision,
      decision: input.decision,
      now: this.#clock.now(),
    });
    if (!result) throw new ExperienceResearchConflictError();
    return result;
  }
}
