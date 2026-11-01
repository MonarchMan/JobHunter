import { z } from 'zod';
import { DomainError } from './domain-error.js';

declare const idBrand: unique symbol;
/** 领域模型的类型约束。 */
export type Id<TName extends string> = string & { readonly [idBrand]: TName };

export type AgentRunId = Id<'AgentRun'>;
export type CandidateProfileId = Id<'CandidateProfile'>;
export type DrillAnswerRevisionId = Id<'DrillAnswerRevision'>;
export type DrillSessionId = Id<'DrillSession'>;
/** 领域模型的类型约束。 */
export type DrillTurnId = Id<'DrillTurn'>;
/** 领域模型的类型约束。 */
export type ExperienceDocumentId = Id<'ExperienceDocument'>;
/** 领域模型的类型约束。 */
export type ExperienceResearchRequestId = Id<'ExperienceResearchRequest'>;
/** 领域模型的类型约束。 */
export type InterviewExperienceId = Id<'InterviewExperience'>;
/** 领域模型的类型约束。 */
export type InterviewQuestionEntryId = Id<'InterviewQuestionEntry'>;
/** 领域模型的类型约束。 */
export type CompanyId = Id<'Company'>;
/** 领域模型的类型约束。 */
export type JobEnrichmentId = Id<'JobEnrichment'>;
/** 领域模型的类型约束。 */
export type JobId = Id<'Job'>;
/** 领域模型的类型约束。 */
export type JobRevisionId = Id<'JobRevision'>;
/** 领域模型的类型约束。 */
export type JobSourceId = Id<'JobSource'>;
/** 领域模型的类型约束。 */
export type SourceChannelId = Id<'SourceChannel'>;
/** 领域模型的类型约束。 */
export type MatchAdviceId = Id<'MatchAdvice'>;
/** 领域模型的类型约束。 */
export type MatchResultId = Id<'MatchResult'>;
/** 领域模型的类型约束。 */
export type MatchRulesetId = Id<'MatchRuleset'>;
/** 领域模型的类型约束。 */
export type ProfileVersionId = Id<'ProfileVersion'>;
/** 领域模型的类型约束。 */
export type ProjectDossierId = Id<'ProjectDossier'>;
/** 领域模型的类型约束。 */
export type ProjectKnowledgeItemId = Id<'ProjectKnowledgeItem'>;
/** 领域模型的类型约束。 */
export type ProjectMaterialChunkId = Id<'ProjectMaterialChunk'>;
/** 领域模型的类型约束。 */
export type ResumeProjectSnapshotId = Id<'ResumeProjectSnapshot'>;
/** 领域模型的类型约束。 */
export type SyncRunId = Id<'SyncRun'>;
/** 领域模型的类型约束。 */
export type TaskId = Id<'Task'>;

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** 校验 UUIDv7 字符串并转换为指定实体的领域 ID。 */
export function parseId<TName extends string>(value: string, entityName: TName): Id<TName> {
  if (!UUID_V7.test(value)) {
    throw new DomainError('INVALID_ID', `Invalid ${entityName} ID.`, { entityName });
  }
  return value as Id<TName>;
}

/** 创建供 API 或持久化边界使用的实体 ID Schema。 */
export function idSchema<TName extends string>(entityName: TName): z.ZodType<Id<TName>> {
  return z
    .string()
    .regex(UUID_V7, `Invalid ${entityName} ID.`)
    .transform((value) => value as Id<TName>);
}

/** 模块数据结构或契约。 */
export interface IdGenerator {
  generate(): string;
}
