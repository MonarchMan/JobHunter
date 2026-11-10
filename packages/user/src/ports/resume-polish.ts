import type { ResumePolishAgentOutput } from '../contracts/resume-polish.js';
/** 润色建议属于 user 业务数据，不使用诊断表充当正文存储。 */
export interface ResumePolishSuggestionStore {
  save(id: string, profileVersionId: string, result: ResumePolishAgentOutput): void;
  get(id: string): unknown;
}
