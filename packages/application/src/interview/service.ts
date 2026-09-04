import { hashCanonical } from '@jobhunter/agent-core';
import {
  assertCanRequestQuestion,
  assertCanSubmitAnswer,
  contentHash,
  drillCoverageDimensions,
  nextSessionStatus,
  parseContentHash,
  parseId,
  type Clock,
  type ContentHash,
  type DrillAnswerRevisionId,
  type DrillSessionId,
  type DrillTurnId,
  type IdGenerator,
  type ProjectDossierId,
  type TaskId,
} from '@jobhunter/domain';
import type { ArtifactStore, QuarantinedArtifact } from '../ports/artifact-store.js';
import type { CandidateProfileRepository } from '../ports/profiles.js';
import type {
  DossierDeletionSnapshot,
  InterviewProjectRepository,
  ProjectNotebookReader,
  ProjectDossierDetail,
  ProjectDossierSummary,
} from '../ports/interview-projects.js';
import {
  InterviewTaskPublicationConflictError,
  type InterviewTaskPublisher,
} from '../ports/interview-task-publisher.js';
import type { EnqueueTaskResult, TaskRecord } from '../tasks/model.js';
import type { TaskService } from '../tasks/task-service.js';
import { latestTurn, questionContextHash } from './context.js';
import {
  docsGroundedProjectQuestionAgentDefinition,
  projectAnswerDigestAgentDefinition,
  projectQuestionAgentDefinition,
} from './agents.js';
import { ProjectMaterialService } from './material.js';
import { drillProfile, drillProfileDefinitionHash, type DrillProfileKey } from './profile.js';

/** 项目拷打档案不存在。 */
export class ProjectDossierNotFoundError extends Error {
  public constructor() {
    super('Project dossier does not exist.');
    this.name = 'ProjectDossierNotFoundError';
  }
}

/** 项目拷打会话不存在。 */
export class DrillSessionNotFoundError extends Error {
  public constructor() {
    super('Drill session does not exist.');
    this.name = 'DrillSessionNotFoundError';
  }
}

/** 项目快照、会话版本或删除确认哈希发生冲突。 */
export class InterviewProjectConflictError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InterviewProjectConflictError';
  }
}

/** 应用层数据结构或端口契约。 */
export interface AvailableResumeProject {
  readonly profileId: string;
  readonly profileName: string;
  readonly profileVersionId: string;
  readonly projectIndex: number;
  readonly projectHash: ContentHash;
  readonly name: string;
  readonly role: string | null;
  readonly highlights: readonly string[];
}

/** 应用层数据结构或端口契约。 */
export interface InterviewTaskAccepted {
  readonly task: TaskRecord;
  readonly deduplicated: boolean;
}

/** 应用层数据结构或端口契约。 */
export interface DossierDeletionImpact {
  readonly impactHash: string;
  readonly snapshot: DossierDeletionSnapshot;
  readonly counts: {
    readonly sessions: number;
    readonly turns: number;
    readonly answerRevisions: number;
    readonly knowledgeItems: number;
    readonly notebookArtifacts: number;
    readonly materialFiles: number;
    readonly materialArtifacts: number;
  };
}

/** 执行应用层的解析、转换或编排辅助逻辑。 */
function accepted(result: EnqueueTaskResult): InterviewTaskAccepted {
  return { task: result.task, deduplicated: result.kind !== 'enqueued' };
}

/** 执行应用层的解析、转换或编排辅助逻辑。 */
function impact(snapshot: DossierDeletionSnapshot): DossierDeletionImpact {
  return {
    impactHash: hashCanonical(snapshot),
    snapshot,
    counts: {
      sessions: snapshot.sessionIds.length,
      turns: snapshot.turnIds.length,
      answerRevisions: snapshot.answerRevisionIds.length,
      knowledgeItems: snapshot.knowledgeItemIds.length,
      notebookArtifacts: snapshot.notebookArtifactId && !snapshot.notebookShared ? 1 : 0,
      materialFiles: snapshot.materialFileIds.length,
      materialArtifacts: snapshot.materialArtifacts.filter((artifact) => !artifact.shared).length,
    },
  };
}

/** 执行应用层的解析、转换或编排辅助逻辑。 */
function exclusiveDeletionArtifacts(
  snapshot: DossierDeletionSnapshot,
): readonly { readonly id: string; readonly relativePath: string }[] {
  const artifacts = new Map<string, string>();
  const add = (id: string, relativePath: string): void => {
    const existing = artifacts.get(id);
    if (existing !== undefined && existing !== relativePath) {
      throw new TypeError('Project deletion artifact path is inconsistent.');
    }
    artifacts.set(id, relativePath);
  };
  if (snapshot.notebookArtifactId && snapshot.notebookRelativePath && !snapshot.notebookShared) {
    add(snapshot.notebookArtifactId, snapshot.notebookRelativePath);
  }
  for (const artifact of snapshot.materialArtifacts) {
    if (!artifact.shared) add(artifact.id, artifact.relativePath);
  }
  return [...artifacts]
    .map(([id, relativePath]) => ({ id, relativePath }))
    .toSorted((left, right) => left.id.localeCompare(right.id));
}

/** 编排项目快照、渐进式拷打会话、回答 digest 和备忘录。 */
export class InterviewProjectService {
  readonly #profiles: CandidateProfileRepository;
  readonly #repository: InterviewProjectRepository;
  readonly #tasks: TaskService;
  readonly #taskPublisher: InterviewTaskPublisher;
  readonly #clock: Clock;
  readonly #ids: IdGenerator;
  readonly #artifacts: ArtifactStore | null;
  readonly #notebooks: ProjectNotebookReader | null;
  readonly #materials: ProjectMaterialService | null;

  /** 执行应用组件对外暴露的操作。 */
  public constructor(input: {
    readonly profiles: CandidateProfileRepository;
    readonly repository: InterviewProjectRepository;
    readonly tasks: TaskService;
    readonly taskPublisher: InterviewTaskPublisher;
    readonly clock: Clock;
    readonly ids: IdGenerator;
    readonly artifacts?: ArtifactStore;
    readonly notebooks?: ProjectNotebookReader;
  }) {
    this.#profiles = input.profiles;
    this.#repository = input.repository;
    this.#tasks = input.tasks;
    this.#taskPublisher = input.taskPublisher;
    this.#clock = input.clock;
    this.#ids = input.ids;
    this.#artifacts = input.artifacts ?? null;
    this.#notebooks = input.notebooks ?? null;
    this.#materials = input.artifacts
      ? new ProjectMaterialService({
          repository: input.repository,
          artifacts: input.artifacts,
          ids: input.ids,
        })
      : null;
  }

  /** 列出当前简历版本中的可拷打项目。 */
  public listAvailableProjects(): readonly AvailableResumeProject[] {
    return this.#profiles.listProfiles().flatMap((profile) => {
      const version = this.#profiles.getCurrentVersion(profile.id);
      if (!version) return [];
      return version.effective.projects.map((project, projectIndex) => ({
        profileId: profile.id,
        profileName: profile.name,
        profileVersionId: version.id,
        projectIndex,
        projectHash: contentHash(project),
        name: project.name,
        role: project.role,
        highlights: project.highlights,
      }));
    });
  }

  /** 列出已创建的项目拷打档案。 */
  public listDossiers(): readonly ProjectDossierSummary[] {
    return this.#repository.listDossiers();
  }

  /** 获取项目档案及其会话、题目、回答和资料详情。 */
  public getDossier(id: string): ProjectDossierDetail {
    const dossier = this.#repository.getDossier(parseId(id, 'ProjectDossier'));
    if (!dossier) throw new ProjectDossierNotFoundError();
    return dossier;
  }

  /** 校验简历项目哈希并创建不可变项目快照。 */
  public createDossier(input: {
    // 1、读取指定简历版本；2、校验项目索引和内容哈希；3、创建快照与档案。
    readonly profileVersionId: string;
    readonly projectIndex: number;
    readonly expectedProjectHash: string;
  }): { readonly dossier: ProjectDossierSummary; readonly deduplicated: boolean } {
    if (!Number.isSafeInteger(input.projectIndex) || input.projectIndex < 0) {
      throw new TypeError('Project index is invalid.');
    }
    const version = this.#profiles.getVersion(parseId(input.profileVersionId, 'ProfileVersion'));
    const project = version?.effective.projects[input.projectIndex];
    if (!version || !project) throw new InterviewProjectConflictError('Resume project changed.');
    const projectHash = contentHash(project);
    if (projectHash !== parseContentHash(input.expectedProjectHash)) {
      throw new InterviewProjectConflictError('Resume project changed.');
    }
    const now = this.#clock.now();
    const snapshotId = parseId(this.#ids.generate(), 'ResumeProjectSnapshot');
    const dossierId = parseId(this.#ids.generate(), 'ProjectDossier');
    const created = this.#repository.createDossier({
      snapshot: {
        id: snapshotId,
        sourceProfileId: version.profileId,
        sourceProfileVersionId: version.id,
        projectIndex: input.projectIndex,
        project,
        contentHash: projectHash,
        createdAt: now,
      },
      dossier: {
        id: dossierId,
        snapshotId,
        latestNotebookArtifactId: null,
        notebookSourceHash: null,
        revision: 0,
        createdAt: now,
        updatedAt: now,
      },
    });
    const summary = this.#repository
      .listDossiers()
      .find((item) => item.dossier.id === created.dossier.id);
    if (!summary) throw new TypeError('Created project dossier is unavailable.');
    return { dossier: summary, deduplicated: created.deduplicated };
  }

  /** 导入深档项目 Markdown 资料并绑定到档案。 */
  public async importMaterial(input: {
    readonly dossierId: string;
    readonly fileName: string;
    readonly bytes: Uint8Array;
    readonly signal: AbortSignal;
  }): ReturnType<ProjectMaterialService['import']> {
    if (!this.#materials) throw new TypeError('Project material import is unavailable.');
    return this.#materials.import({
      ...input,
      dossierId: parseId(input.dossierId, 'ProjectDossier'),
      createdAt: this.#clock.now(),
    });
  }

  /** 创建指定档位的拷打会话并冻结资料绑定。 */
  public startSession(
    // 1、校验档案与档位；2、冻结当前资料和 profile 哈希；3、创建待提问会话。
    dossierIdValue: string,
    input: {
      readonly profileKey?: DrillProfileKey;
      readonly materialFileIds?: readonly string[];
    } = {},
  ): {
    readonly sessionId: DrillSessionId;
    readonly deduplicated: boolean;
  } {
    const dossierId = parseId(dossierIdValue, 'ProjectDossier');
    const detail = this.#repository.getDossier(dossierId);
    if (!detail) throw new ProjectDossierNotFoundError();
    const profileKey = input.profileKey ?? 'resume-only';
    const profile = drillProfile(profileKey);
    const fileIds = [...new Set(input.materialFileIds ?? [])];
    if (profileKey === 'resume-only' && fileIds.length > 0) {
      throw new InterviewProjectConflictError(
        'Resume-only sessions cannot bind project materials.',
      );
    }
    if (profileKey === 'docs-grounded' && (fileIds.length < 1 || fileIds.length > 8)) {
      throw new InterviewProjectConflictError('Docs-grounded sessions require 1 to 8 materials.');
    }
    const materialBindings =
      profileKey === 'docs-grounded'
        ? this.#repository.resolveMaterialBindings(dossierId, fileIds)
        : [];
    if (materialBindings.length !== fileIds.length) {
      throw new InterviewProjectConflictError('Selected project material is unavailable.');
    }
    const existing = detail.sessionRecords.find((session) => session.status !== 'completed');
    if (existing) {
      if (
        existing.profileKey === profileKey &&
        JSON.stringify(existing.materialBindings) === JSON.stringify(materialBindings)
      ) {
        return { sessionId: existing.id, deduplicated: true };
      }
      throw new InterviewProjectConflictError(
        'Complete the current drill session before changing profile or materials.',
      );
    }
    const now = this.#clock.now();
    const sessionId = parseId(this.#ids.generate(), 'DrillSession');
    this.#repository.createSession({
      session: {
        id: sessionId,
        dossierId,
        profileKey: profile.key,
        profileVersion: profile.version,
        profileDefinitionHash: drillProfileDefinitionHash(profileKey),
        capabilitySummary: {
          evidenceKinds: profile.evidenceKinds,
          tools: profile.tools,
        },
        materialBindings,
        status: 'active',
        contextRevision: 0,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      },
      coverage: drillCoverageDimensions.map((dimension) => ({
        sessionId,
        dimension,
        status: 'unasked',
        evidenceItemIds: [],
        updatedAt: now,
      })),
    });
    this.enqueueNotebook(dossierId);
    return { sessionId, deduplicated: false };
  }

  /** 为会话申请下一题，并幂等投递问题生成任务。 */
  public requestQuestion(sessionIdValue: string): InterviewTaskAccepted {
    const sessionId = parseId(sessionIdValue, 'DrillSession');
    const session = this.#repository.getSession(sessionId);
    if (!session) throw new DrillSessionNotFoundError();
    const detail = this.#repository.getDossier(session.dossierId);
    if (!detail) throw new ProjectDossierNotFoundError();
    const current = latestTurn(detail, sessionId);
    if (current?.status === 'question_pending') {
      if (current.questionTaskId) {
        const task = this.#tasks.get(current.questionTaskId);
        if (task) return { task, deduplicated: true };
      }
      return this.#enqueueQuestion(session, current.id, current.turnNo, current.contextHash);
    }
    assertCanRequestQuestion(session.status, current?.status ?? null);
    const turnNo = (current?.turnNo ?? 0) + 1;
    const turnId = parseId(this.#ids.generate(), 'DrillTurn');
    const contextHash = questionContextHash(session, turnNo);
    const now = this.#clock.now();
    this.#repository.createQuestionTurn({
      expectedSessionRevision: session.contextRevision,
      turn: {
        id: turnId,
        sessionId,
        turnNo,
        status: 'question_pending',
        contextHash,
        question: null,
        intent: null,
        primaryDimension: null,
        guidanceSlots: [],
        evidenceRefs: [],
        questionTaskId: null,
        questionAgentRunId: null,
        digestTaskId: null,
        digestAgentRunId: null,
        createdAt: now,
        updatedAt: now,
      },
    });
    try {
      return this.#enqueueQuestion(session, turnId, turnNo, contextHash);
    } catch (error) {
      this.#repository.removeUnqueuedQuestionTurn(turnId);
      throw error;
    }
  }

  /** 处理应用类内部的辅助逻辑。 */
  #enqueueQuestion(
    session: NonNullable<ReturnType<InterviewProjectRepository['getSession']>>,
    turnId: DrillTurnId,
    turnNo: number,
    contextHash: ContentHash,
  ): InterviewTaskAccepted {
    let result: EnqueueTaskResult;
    try {
      result = this.#taskPublisher.publishProjectQuestion({
        command: {
          taskType: 'interview.project-question',
          payload: {
            dossierId: session.dossierId,
            sessionId: session.id,
            turnId,
            expectedContextRevision: session.contextRevision,
            contextHash,
          },
          idempotencyKey: `interview.project-question:${session.id}:${String(turnNo)}:${contextHash}`,
        },
        turnId,
        now: this.#clock.now(),
      });
    } catch (error) {
      if (error instanceof InterviewTaskPublicationConflictError) {
        throw new InterviewProjectConflictError('另一个面试任务仍在收尾，请稍后重试。');
      }
      throw error;
    }
    return accepted(result);
  }

  /** 保存用户回答并投递回答 digest 任务。 */
  public submitAnswer(input: {
    // 1、校验当前题目状态；2、保存回答修订；3、推进会话版本；4、投递 digest 任务。
    readonly sessionId: string;
    readonly turnId: string;
    readonly answer: string;
    readonly idempotencyToken: string;
  }): InterviewTaskAccepted {
    if (!input.answer.trim() || input.answer.length > 20_000) {
      throw new TypeError('Answer must contain between 1 and 20,000 characters.');
    }
    const token = input.idempotencyToken.trim();
    if (token.length < 8 || token.length > 200) throw new TypeError('Answer token is invalid.');
    const sessionId = parseId(input.sessionId, 'DrillSession');
    const turnId = parseId(input.turnId, 'DrillTurn');
    const session = this.#repository.getSession(sessionId);
    if (!session) throw new DrillSessionNotFoundError();
    const detail = this.#repository.getDossier(session.dossierId);
    const turn = detail?.turns.find((item) => item.id === turnId && item.sessionId === sessionId);
    if (!detail || !turn) throw new InterviewProjectConflictError('Drill turn is unavailable.');
    const idempotencyKey = contentHash({ turnId, token });
    const existingAnswer = detail.answers.find(
      (item) => item.turnId === turnId && item.idempotencyKey === idempotencyKey,
    );
    if (existingAnswer && turn.digestTaskId) {
      const task = this.#tasks.get(turn.digestTaskId);
      if (task) return { task, deduplicated: true };
    }
    if (existingAnswer && turn.status === 'digest_pending' && turn.digestTaskId === null) {
      const recovered = this.#enqueueAnswerDigest({
        dossierId: session.dossierId,
        sessionId,
        turnId,
        answerRevisionId: existingAnswer.id,
      });
      this.enqueueNotebook(session.dossierId);
      return accepted(recovered);
    }
    assertCanSubmitAnswer(session.status, turn.status);
    const now = this.#clock.now();
    const result = this.#repository.appendAnswer({
      sessionId,
      turnId,
      expectedSessionRevision: session.contextRevision,
      answer: {
        id: parseId(this.#ids.generate(), 'DrillAnswerRevision'),
        turnId,
        revisionNo: 1,
        answer: input.answer,
        contentHash: contentHash(input.answer),
        idempotencyKey,
        createdAt: now,
      },
      now,
    });
    const refreshed = this.#repository.getDossier(session.dossierId);
    const refreshedTurn = refreshed?.turns.find((item) => item.id === turnId);
    if (refreshedTurn?.digestTaskId) {
      const task = this.#tasks.get(refreshedTurn.digestTaskId);
      if (task) return { task, deduplicated: true };
    }
    const queued = this.#enqueueAnswerDigest({
      dossierId: session.dossierId,
      sessionId,
      turnId,
      answerRevisionId: result.answer.id,
    });
    this.enqueueNotebook(session.dossierId);
    return accepted(queued);
  }

  /** 处理应用类内部的辅助逻辑。 */
  #enqueueAnswerDigest(input: {
    readonly dossierId: ProjectDossierId;
    readonly sessionId: DrillSessionId;
    readonly turnId: DrillTurnId;
    readonly answerRevisionId: DrillAnswerRevisionId;
  }): EnqueueTaskResult {
    try {
      return this.#taskPublisher.publishProjectAnswerDigest({
        command: {
          taskType: 'interview.project-answer-digest',
          payload: {
            dossierId: input.dossierId,
            sessionId: input.sessionId,
            turnId: input.turnId,
            answerRevisionId: input.answerRevisionId,
          },
          idempotencyKey: `interview.project-answer-digest:${input.answerRevisionId}`,
        },
        turnId: input.turnId,
        now: this.#clock.now(),
      });
    } catch (error) {
      if (error instanceof InterviewTaskPublicationConflictError) {
        throw new InterviewProjectConflictError('另一个面试任务仍在收尾，请稍后重试。');
      }
      throw error;
    }
  }

  /** 跳过当前题目并记录会话状态变化。 */
  public skipTurn(turnIdValue: string): void {
    const turn = this.#repository.skipTurn({
      turnId: parseId(turnIdValue, 'DrillTurn'),
      now: this.#clock.now(),
    });
    const session = this.#repository.getSession(turn.sessionId);
    if (session) this.enqueueNotebook(session.dossierId);
  }

  /** 取消尚未生成题目的任务，避免陈旧结果落库。 */
  public cancelPendingTurn(turnIdValue: string): void {
    const turnId = parseId(turnIdValue, 'DrillTurn');
    const detail = this.#repository
      .listDossiers()
      .map((item) => this.#repository.getDossier(item.dossier.id))
      .find((item) => item?.turns.some((turn) => turn.id === turnId));
    const turn = detail?.turns.find((item) => item.id === turnId);
    if (!detail || !turn) throw new InterviewProjectConflictError('Drill turn is unavailable.');
    const taskId = turn.status === 'question_pending' ? turn.questionTaskId : turn.digestTaskId;
    if (taskId) this.#tasks.cancel(taskId);
    this.#repository.cancelPendingTurn({ turnId, now: this.#clock.now() });
    this.enqueueNotebook(detail.dossier.id);
  }

  /** 按领域状态机推进拷打会话。 */
  public transitionSession(input: {
    readonly sessionId: string;
    readonly action: 'pause' | 'resume' | 'complete';
  }): void {
    const sessionId = parseId(input.sessionId, 'DrillSession');
    const session = this.#repository.getSession(sessionId);
    if (!session) throw new DrillSessionNotFoundError();
    const detail = this.#repository.getDossier(session.dossierId);
    const current = detail ? latestTurn(detail, sessionId) : null;
    if (
      input.action !== 'resume' &&
      current &&
      ['question_pending', 'digest_pending'].includes(current.status)
    ) {
      throw new InterviewProjectConflictError(
        'Cancel or wait for the current task before changing the session state.',
      );
    }
    const status = nextSessionStatus(session.status, input.action);
    const updated = this.#repository.updateSessionStatus({
      id: sessionId,
      expectedStatus: session.status,
      status,
      now: this.#clock.now(),
    });
    if (!updated) throw new InterviewProjectConflictError('Drill session changed.');
    this.enqueueNotebook(session.dossierId);
  }

  /** 投递项目拷打备忘录生成任务。 */
  public enqueueNotebook(dossierIdValue: string | ProjectDossierId): InterviewTaskAccepted {
    const dossierId = parseId(dossierIdValue, 'ProjectDossier');
    const detail = this.#repository.getDossier(dossierId);
    if (!detail) throw new ProjectDossierNotFoundError();
    return accepted(
      this.#tasks.enqueue({
        taskType: 'interview.project-notebook.render',
        payload: { dossierId, sourceRevision: detail.dossier.revision },
        idempotencyKey: `interview.project-notebook:${dossierId}:${String(detail.dossier.revision)}`,
      }),
    );
  }

  /** 读取最新备忘录或返回尚未生成的状态。 */
  public async readNotebook(
    dossierIdValue: string,
    signal: AbortSignal,
  ): Promise<{
    readonly filename: string;
    readonly mediaType: string;
    readonly content: Uint8Array;
  }> {
    const detail = this.getDossier(dossierIdValue);
    const artifactId = detail.dossier.latestNotebookArtifactId;
    if (!artifactId || !this.#notebooks) {
      throw new InterviewProjectConflictError('Project notebook is not ready.');
    }
    const notebook = await this.#notebooks.read(artifactId, 5 * 1024 * 1024, signal);
    const stem = detail.snapshot.project.name
      .normalize('NFKC')
      .replaceAll(/[^\p{Letter}\p{Number}._-]+/gu, '-')
      .replaceAll(/^-+|-+$/g, '')
      .slice(0, 80);
    return {
      filename: `${stem || 'project'}-interview-notebook.md`,
      ...notebook,
    };
  }

  /** 预览项目档案删除影响并生成确认哈希。 */
  public previewDeletion(dossierIdValue: string): DossierDeletionImpact {
    const snapshot = this.#repository.previewDeletion(parseId(dossierIdValue, 'ProjectDossier'));
    if (!snapshot) throw new ProjectDossierNotFoundError();
    return impact(snapshot);
  }

  /** 按确认哈希删除档案、会话记录和独占资料文件。 */
  public async deleteConfirmed(input: {
    // 1、重新计算影响；2、校验确认哈希；3、事务删除结构化数据；4、清理物理文件。
    readonly dossierId: string;
    readonly expectedImpactHash: string;
  }): Promise<{
    readonly impactHash: string;
    readonly pendingArtifactPurgeId: string | null;
    readonly pendingArtifactPurgeIds: readonly string[];
  }> {
    const current = this.previewDeletion(input.dossierId);
    if (current.impactHash !== input.expectedImpactHash) {
      throw new InterviewProjectConflictError('Project dossier deletion impact changed.');
    }
    const detail = this.#repository.getDossier(current.snapshot.dossierId);
    for (const turn of detail?.turns ?? []) {
      const taskIds: (TaskId | null)[] = [turn.questionTaskId, turn.digestTaskId];
      for (const taskId of taskIds) {
        const task = taskId ? this.#tasks.get(taskId) : null;
        if (task?.status === 'pending' || task?.status === 'running') this.#tasks.cancel(task.id);
      }
    }
    const deletionArtifacts = exclusiveDeletionArtifacts(current.snapshot);
    const artifactStore = this.#artifacts;
    const quarantined: QuarantinedArtifact[] = [];
    try {
      if (deletionArtifacts.length > 0) {
        if (!artifactStore) throw new TypeError('Project artifact deletion is unavailable.');
        for (const artifact of deletionArtifacts) {
          quarantined.push(await artifactStore.quarantine(artifact.id, artifact.relativePath));
        }
      }
      const deleted = this.#repository.deleteDossier({
        expected: current.snapshot,
        quarantinedArtifacts: quarantined,
        deletedAt: this.#clock.now(),
      });
      if (!deleted)
        throw new InterviewProjectConflictError('Project dossier deletion impact changed.');
    } catch (error) {
      const restoreErrors: unknown[] = [];
      for (const artifact of quarantined.toReversed()) {
        try {
          await this.#artifacts?.restoreQuarantined(artifact);
        } catch (restoreError) {
          restoreErrors.push(restoreError);
        }
      }
      if (restoreErrors.length > 0) {
        throw new AggregateError(
          [error, ...restoreErrors],
          'Project dossier deletion rollback failed.',
        );
      }
      throw error;
    }
    const pendingArtifactPurgeIds: string[] = [];
    for (const artifact of quarantined) {
      try {
        if (!artifactStore) throw new TypeError('Project artifact deletion is unavailable.');
        await artifactStore.purgeQuarantined(artifact);
        this.#repository.removePurgedArtifact(artifact.artifactId);
      } catch {
        pendingArtifactPurgeIds.push(artifact.artifactId);
      }
    }
    return {
      impactHash: current.impactHash,
      pendingArtifactPurgeId: pendingArtifactPurgeIds[0] ?? null,
      pendingArtifactPurgeIds,
    };
  }
}

/** 应用服务使用的稳定配置或常量。 */
export const interviewAgentVersions = {
  question: projectQuestionAgentDefinition.version,
  docsQuestion: docsGroundedProjectQuestionAgentDefinition.version,
  answerDigest: projectAnswerDigestAgentDefinition.version,
} as const;
