import type {
  ContentHash,
  ExperienceResearchBrief,
  ExperienceResearchRequestId,
  InterviewExperienceId,
  InterviewQuestionEntryId,
  TaskId,
  UtcInstant,
} from '@jobhunter/domain';
import type { TaskErrorCategory, TaskStatus } from '../tasks/model.js';

/** 应用层使用的类型约束。 */
export type ResearchRequestState = 'ready' | 'needs_review' | 'completed';

/** 应用层数据结构或端口契约。 */
export interface ExperienceResearchRequestRecord {
  readonly id: ExperienceResearchRequestId;
  readonly brief: ExperienceResearchBrief;
  readonly requestFingerprint: ContentHash;
  readonly promptVersion: string;
  readonly schemaVersion: string;
  readonly promptFileId: string;
  readonly promptFileVersionNo: number;
  readonly schemaFileId: string;
  readonly schemaFileVersionNo: number;
  readonly bundleFileId: string | null;
  readonly bundleFileVersionNo: number | null;
  readonly currentTaskId: TaskId | null;
  readonly state: ResearchRequestState;
  readonly revision: number;
  readonly createdAt: UtcInstant;
  readonly updatedAt: UtcInstant;
}

/** 应用层数据结构或端口契约。 */
export interface ExperienceResearchTaskSnapshot {
  readonly id: TaskId;
  readonly status: TaskStatus;
  readonly errorCategory: TaskErrorCategory | null;
}

/** 应用层数据结构或端口契约。 */
export interface ExperienceResearchRequestSummary {
  readonly request: ExperienceResearchRequestRecord;
  readonly currentTask: ExperienceResearchTaskSnapshot | null;
}

/** 应用层数据结构或端口契约。 */
export interface CommunityInterviewExperienceRecord {
  readonly id: InterviewExperienceId;
  readonly fileId: string;
  readonly sequenceNo: number;
  readonly researchRequestId: ExperienceResearchRequestId;
  readonly reviewStatus: 'needs_review' | 'accepted' | 'rejected';
  readonly company: string | null;
  readonly role: string | null;
  readonly stage: string | null;
  readonly occurredOn: string | null;
  readonly tags: readonly string[];
  readonly notes: string | null;
  readonly sourceUrl: string;
  readonly sourceTitle: string;
  readonly sourcePublishedAt: string | null;
  readonly sourceRetrievedAt: string;
  readonly verificationStatus: 'unverified';
}

/** 应用层数据结构或端口契约。 */
export interface CommunityInterviewQuestionRecord {
  readonly id: InterviewQuestionEntryId;
  readonly experienceId: InterviewExperienceId;
  readonly sequenceNo: number;
  readonly question: string;
  readonly answerExcerpt: string | null;
  readonly topics: readonly string[];
  readonly evidenceExcerpt: string;
  readonly questionFingerprint: ContentHash;
}

/** 应用层数据结构或端口契约。 */
export interface ExperienceResearchDetail {
  readonly request: ExperienceResearchRequestRecord;
  readonly experiences: readonly CommunityInterviewExperienceRecord[];
  readonly questions: readonly CommunityInterviewQuestionRecord[];
  readonly warnings: readonly string[];
  readonly occurrenceCounts: Readonly<Record<string, number>>;
}

/** 应用层数据结构或端口契约。 */
export interface CommunityExperienceSummary {
  readonly experience: CommunityInterviewExperienceRecord;
  readonly questions: readonly CommunityInterviewQuestionRecord[];
  readonly occurrenceCounts: Readonly<Record<string, number>>;
}

/** 应用层数据结构或端口契约。 */
export interface CommunityExperienceFilter {
  readonly company?: string;
  readonly role?: string;
  readonly stage?: string;
}

/** 应用层数据结构或端口契约。 */
export interface InterviewResearchRepository {
  findByFingerprint(fingerprint: ContentHash): ExperienceResearchDetail | null;
  createRequest(request: ExperienceResearchRequestRecord): ExperienceResearchDetail;
  listRequests(): readonly ExperienceResearchRequestRecord[];
  getRequest(id: ExperienceResearchRequestId): ExperienceResearchDetail | null;
  attachTask(input: {
    readonly requestId: ExperienceResearchRequestId;
    readonly expectedRevision: number;
    readonly taskId: TaskId;
    readonly now: UtcInstant;
  }): boolean;
  claimBundleImport(input: {
    readonly requestId: ExperienceResearchRequestId;
    readonly expectedRevision: number;
    readonly taskId?: TaskId;
    readonly claimToken: string;
    readonly stagingFileId: string;
    readonly now: UtcInstant;
    readonly staleBefore: UtcInstant;
  }): boolean;
  replaceCandidates(input: {
    readonly requestId: ExperienceResearchRequestId;
    readonly expectedRevision: number;
    readonly taskId?: TaskId;
    readonly claimToken: string;
    readonly bundleFileId: string;
    readonly stagingFileId: string;
    readonly stagingFileVersionNo: number;
    readonly stagingEntityId: string;
    readonly experiences: readonly CommunityInterviewExperienceRecord[];
    readonly questions: readonly CommunityInterviewQuestionRecord[];
    readonly warnings: readonly string[];
    readonly now: UtcInstant;
  }): ExperienceResearchDetail | null;
  abandonBundleImport(input: {
    readonly requestId: ExperienceResearchRequestId;
    readonly claimToken: string;
    readonly stagingFileId: string;
  }): void;
  reviewCandidate(input: {
    readonly requestId: ExperienceResearchRequestId;
    readonly experienceId: InterviewExperienceId;
    readonly expectedRevision: number;
    readonly decision: 'accept' | 'reject';
    readonly now: UtcInstant;
  }): ExperienceResearchDetail | null;
  listAccepted(filter?: CommunityExperienceFilter): readonly CommunityExperienceSummary[];
}
