import { z } from 'zod';
import { DomainError } from './domain-error.js';

declare const idBrand: unique symbol;
export type Id<TName extends string> = string & { readonly [idBrand]: TName };

export type AgentRunId = Id<'AgentRun'>;
export type CandidateProfileId = Id<'CandidateProfile'>;
export type DrillAnswerRevisionId = Id<'DrillAnswerRevision'>;
export type DrillSessionId = Id<'DrillSession'>;
export type DrillTurnId = Id<'DrillTurn'>;
export type CompanyId = Id<'Company'>;
export type JobEnrichmentId = Id<'JobEnrichment'>;
export type JobId = Id<'Job'>;
export type JobRevisionId = Id<'JobRevision'>;
export type JobSourceId = Id<'JobSource'>;
export type SourceChannelId = Id<'SourceChannel'>;
export type MatchAdviceId = Id<'MatchAdvice'>;
export type MatchResultId = Id<'MatchResult'>;
export type MatchRulesetId = Id<'MatchRuleset'>;
export type ProfileVersionId = Id<'ProfileVersion'>;
export type ProjectDossierId = Id<'ProjectDossier'>;
export type ProjectKnowledgeItemId = Id<'ProjectKnowledgeItem'>;
export type ResumeProjectSnapshotId = Id<'ResumeProjectSnapshot'>;
export type SyncRunId = Id<'SyncRun'>;
export type TaskId = Id<'Task'>;

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseId<TName extends string>(value: string, entityName: TName): Id<TName> {
  if (!UUID_V7.test(value)) {
    throw new DomainError('INVALID_ID', `Invalid ${entityName} ID.`, { entityName });
  }
  return value as Id<TName>;
}

export function idSchema<TName extends string>(entityName: TName): z.ZodType<Id<TName>> {
  return z
    .string()
    .regex(UUID_V7, `Invalid ${entityName} ID.`)
    .transform((value) => value as Id<TName>);
}

export interface IdGenerator {
  generate(): string;
}
