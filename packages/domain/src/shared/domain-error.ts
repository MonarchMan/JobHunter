export type DomainErrorCode =
  | 'INVALID_DOMAIN_VALUE'
  | 'INVALID_ID'
  | 'INVALID_STATE_TRANSITION'
  | 'INTERVIEW_EVIDENCE_INVALID'
  | 'INTERVIEW_QUESTION_UNSAFE'
  | 'JOB_IDENTITY_CONFLICT'
  | 'MATCH_IDENTITY_INCOMPLETE'
  | 'PROFILE_LOCK_INVALID';

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
