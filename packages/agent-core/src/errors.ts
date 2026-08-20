export const agentErrorCategories = [
  'rate_limited',
  'temporary',
  'invalid_auth',
  'invalid_request',
  'content_rejected',
  'cancelled',
  'timeout',
  'budget_exceeded',
  'invalid_output',
  'tool_error',
  'configuration',
  'cache_race_resolved',
  'unknown',
] as const;

export type AgentErrorCategory = (typeof agentErrorCategories)[number];

export class AgentRuntimeError extends Error {
  public readonly category: AgentErrorCategory;
  public readonly retryable: boolean;

  public constructor(category: AgentErrorCategory, message: string, retryable = false) {
    super(message);
    this.name = 'AgentRuntimeError';
    this.category = category;
    this.retryable = retryable;
  }
}

export class ModelClientError extends AgentRuntimeError {
  public constructor(category: AgentErrorCategory, message: string, retryable = false) {
    super(category, message, retryable);
    this.name = 'ModelClientError';
  }
}

export function sanitizeAgentErrorSummary(summary: string): string {
  return summary
    .replaceAll(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]')
    .replaceAll(/(api[-_ ]?key|token|password|cookie)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replaceAll(/[\r\n\t]+/g, ' ')
    .replaceAll(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 300);
}

export function classifyAgentError(error: unknown): AgentRuntimeError {
  if (error instanceof AgentRuntimeError) return error;
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new AgentRuntimeError('cancelled', 'Agent run was cancelled.');
  }
  return new AgentRuntimeError(
    'unknown',
    error instanceof Error ? error.message : 'Unknown error.',
  );
}
