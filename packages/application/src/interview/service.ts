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
import type { EnqueueTaskResult, TaskRecord } from '../tasks/model.js';
import type { TaskService } from '../tasks/task-service.js';
import { latestTurn, questionContextHash } from './context.js';
import { projectAnswerDigestAgentDefinition, projectQuestionAgentDefinition } from './agents.js';
import { resumeOnlyDrillProfile, resumeOnlyDrillProfileDefinitionHash } from './profile.js';

export class ProjectDossierNotFoundError extends Error {
  public constructor() {
    super('Project dossier does not exist.');
    this.name = 'ProjectDossierNotFoundError';
  }
}

export class DrillSessionNotFoundError extends Error {
  public constructor() {
    super('Drill session does not exist.');
    this.name = 'DrillSessionNotFoundError';
  }
}

export class InterviewProjectConflictError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InterviewProjectConflictError';
  }
}

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

export interface InterviewTaskAccepted {
  readonly task: TaskRecord;
  readonly deduplicated: boolean;
}

export interface DossierDeletionImpact {
  readonly impactHash: string;
  readonly snapshot: DossierDeletionSnapshot;
  readonly counts: {
    readonly sessions: number;
    readonly turns: number;
    readonly answerRevisions: number;
    readonly knowledgeItems: number;
    readonly notebookArtifacts: number;
  };
}

function accepted(result: EnqueueTaskResult): InterviewTaskAccepted {
  return { task: result.task, deduplicated: result.kind !== 'enqueued' };
}

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
    },
  };
}

export class InterviewProjectService {
  readonly #profiles: CandidateProfileRepository;
  readonly #repository: InterviewProjectRepository;
  readonly #tasks: TaskService;
  readonly #clock: Clock;
  readonly #ids: IdGenerator;
  readonly #artifacts: ArtifactStore | null;
  readonly #notebooks: ProjectNotebookReader | null;

  public constructor(input: {
    readonly profiles: CandidateProfileRepository;
    readonly repository: InterviewProjectRepository;
    readonly tasks: TaskService;
    readonly clock: Clock;
    readonly ids: IdGenerator;
    readonly artifacts?: ArtifactStore;
    readonly notebooks?: ProjectNotebookReader;
  }) {
    this.#profiles = input.profiles;
    this.#repository = input.repository;
    this.#tasks = input.tasks;
    this.#clock = input.clock;
    this.#ids = input.ids;
    this.#artifacts = input.artifacts ?? null;
    this.#notebooks = input.notebooks ?? null;
  }

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

  public listDossiers(): readonly ProjectDossierSummary[] {
    return this.#repository.listDossiers();
  }

  public getDossier(id: string): ProjectDossierDetail {
    const dossier = this.#repository.getDossier(parseId(id, 'ProjectDossier'));
    if (!dossier) throw new ProjectDossierNotFoundError();
    return dossier;
  }

  public createDossier(input: {
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

  public startSession(dossierIdValue: string): {
    readonly sessionId: DrillSessionId;
    readonly deduplicated: boolean;
  } {
    const dossierId = parseId(dossierIdValue, 'ProjectDossier');
    const detail = this.#repository.getDossier(dossierId);
    if (!detail) throw new ProjectDossierNotFoundError();
    const existing = detail.sessionRecords.find((session) => session.status !== 'completed');
    if (existing) return { sessionId: existing.id, deduplicated: true };
    const now = this.#clock.now();
    const sessionId = parseId(this.#ids.generate(), 'DrillSession');
    this.#repository.createSession({
      session: {
        id: sessionId,
        dossierId,
        profileKey: resumeOnlyDrillProfile.key,
        profileVersion: resumeOnlyDrillProfile.version,
        profileDefinitionHash: resumeOnlyDrillProfileDefinitionHash,
        capabilitySummary: {
          evidenceKinds: resumeOnlyDrillProfile.evidenceKinds,
          tools: resumeOnlyDrillProfile.tools,
        },
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

  #enqueueQuestion(
    session: NonNullable<ReturnType<InterviewProjectRepository['getSession']>>,
    turnId: DrillTurnId,
    turnNo: number,
    contextHash: ContentHash,
  ): InterviewTaskAccepted {
    const result = this.#tasks.enqueue({
      taskType: 'interview.project-question',
      payload: {
        dossierId: session.dossierId,
        sessionId: session.id,
        turnId,
        expectedContextRevision: session.contextRevision,
        contextHash,
      },
      idempotencyKey: `interview.project-question:${session.id}:${String(turnNo)}:${contextHash}`,
    });
    this.#repository.attachQuestionTask({
      turnId,
      taskId: result.task.id,
      now: this.#clock.now(),
    });
    return accepted(result);
  }

  public submitAnswer(input: {
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
    const queued = this.#tasks.enqueue({
      taskType: 'interview.project-answer-digest',
      payload: {
        dossierId: session.dossierId,
        sessionId,
        turnId,
        answerRevisionId: result.answer.id,
      },
      idempotencyKey: `interview.project-answer-digest:${result.answer.id}`,
    });
    this.#repository.attachDigestTask({ turnId, taskId: queued.task.id, now: this.#clock.now() });
    this.enqueueNotebook(session.dossierId);
    return accepted(queued);
  }

  public skipTurn(turnIdValue: string): void {
    const turn = this.#repository.skipTurn({
      turnId: parseId(turnIdValue, 'DrillTurn'),
      now: this.#clock.now(),
    });
    const session = this.#repository.getSession(turn.sessionId);
    if (session) this.enqueueNotebook(session.dossierId);
  }

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

  public previewDeletion(dossierIdValue: string): DossierDeletionImpact {
    const snapshot = this.#repository.previewDeletion(parseId(dossierIdValue, 'ProjectDossier'));
    if (!snapshot) throw new ProjectDossierNotFoundError();
    return impact(snapshot);
  }

  public async deleteConfirmed(input: {
    readonly dossierId: string;
    readonly expectedImpactHash: string;
  }): Promise<{ readonly impactHash: string; readonly pendingArtifactPurgeId: string | null }> {
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
    let quarantined: QuarantinedArtifact | null = null;
    if (
      !current.snapshot.notebookShared &&
      current.snapshot.notebookArtifactId &&
      current.snapshot.notebookRelativePath
    ) {
      if (!this.#artifacts) throw new TypeError('Project notebook deletion is unavailable.');
      quarantined = await this.#artifacts.quarantine(
        current.snapshot.notebookArtifactId,
        current.snapshot.notebookRelativePath,
      );
    }
    try {
      const deleted = this.#repository.deleteDossier({
        expected: current.snapshot,
        quarantinedArtifact: quarantined,
        deletedAt: this.#clock.now(),
      });
      if (!deleted)
        throw new InterviewProjectConflictError('Project dossier deletion impact changed.');
    } catch (error) {
      if (quarantined && this.#artifacts) await this.#artifacts.restoreQuarantined(quarantined);
      throw error;
    }
    if (quarantined && this.#artifacts) {
      try {
        await this.#artifacts.purgeQuarantined(quarantined);
        this.#repository.removePurgedNotebookArtifact(quarantined.artifactId);
      } catch {
        return { impactHash: current.impactHash, pendingArtifactPurgeId: quarantined.artifactId };
      }
    }
    return { impactHash: current.impactHash, pendingArtifactPurgeId: null };
  }
}

export const interviewAgentVersions = {
  question: projectQuestionAgentDefinition.version,
  answerDigest: projectAnswerDigestAgentDefinition.version,
} as const;
