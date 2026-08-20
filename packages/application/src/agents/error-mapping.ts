import type { AgentRuntimeError } from '@jobhunter/agent-core';
import { TaskExecutionError } from '../tasks/retry-policy.js';

export function mapAgentRuntimeError(
  error: AgentRuntimeError,
  operation: string,
): TaskExecutionError {
  switch (error.category) {
    case 'rate_limited':
      return new TaskExecutionError('rate_limited', `${operation} was rate limited.`, {
        cause: error,
      });
    case 'temporary':
    case 'timeout':
      return new TaskExecutionError(
        'network_temporary',
        `${operation} is temporarily unavailable.`,
        {
          cause: error,
        },
      );
    case 'cancelled':
      return new TaskExecutionError('cancelled', `${operation} was cancelled.`, { cause: error });
    case 'invalid_auth':
    case 'configuration':
      return new TaskExecutionError('invalid_config', `${operation} configuration is invalid.`, {
        cause: error,
      });
    case 'invalid_output':
    case 'budget_exceeded':
      return new TaskExecutionError('validation_failed', `${operation} output was rejected.`, {
        cause: error,
      });
    default:
      return new TaskExecutionError('permanent', `${operation} failed.`, { cause: error });
  }
}
