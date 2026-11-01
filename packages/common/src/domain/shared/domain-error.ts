/** 领域模型的类型约束。 */
export type DomainErrorCode =
  | 'INVALID_DOMAIN_VALUE'
  | 'INVALID_ID'
  | 'INVALID_STATE_TRANSITION'
  | 'INVALID_EXPERIENCE_TEXT'
  | 'INVALID_RESEARCH_QUESTION'
  | 'INVALID_RESEARCH_SOURCE'
  | 'EXPERIENCE_HAS_NO_QUESTIONS'
  | 'INTERVIEW_EVIDENCE_INVALID'
  | 'INTERVIEW_QUESTION_UNSAFE'
  | 'JOB_IDENTITY_CONFLICT'
  | 'MATCH_IDENTITY_INCOMPLETE'
  | 'PROFILE_LOCK_INVALID';

/** 领域规则校验失败时抛出的错误，允许携带脱敏结构化细节。 */
export class DomainError extends Error {
  public readonly code: DomainErrorCode;
  public readonly details: Readonly<Record<string, boolean | number | string | null>> | undefined;

  public constructor(
    code: DomainErrorCode,
    message: string,
    details?: Readonly<Record<string, boolean | number | string | null>>,
  ) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }
}
