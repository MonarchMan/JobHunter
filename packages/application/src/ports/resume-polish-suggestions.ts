import type { ResumePolishAgentOutput, ResumePolishSection } from '@jobhunter/resume';

export interface ResumePolishSuggestionRecord {
  readonly id: string;
  readonly profileId: string;
  readonly sourceVersionId: string;
  readonly sections: readonly ResumePolishSection[];
  readonly result: ResumePolishAgentOutput;
  readonly agentRunId: string;
  readonly createdAt: number;
}

export interface ResumePolishSuggestionRepository {
  get(id: string): ResumePolishSuggestionRecord | null;
  save(record: ResumePolishSuggestionRecord): void;
}
