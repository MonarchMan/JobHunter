import type { AgentRuntimeError } from '@jobhunter/common/agent';
import { TaskExecutionError } from './retry-policy.js';

/** 将 Agent 运行分类映射为任务队列可执行的重试策略。 */
export function mapAgentRuntimeError(
  error: AgentRuntimeError,
  operation: string,
): TaskExecutionError {
  switch (error.category) {
    case 'rate_limited':
      return new TaskExecutionError('rate_limited', `${operation}失败：模型请求触发限流。`, {
        cause: error,
      });
    case 'timeout':
      return new TaskExecutionError('network_temporary', `${operation}失败：模型请求超时。`, {
        cause: error,
      });
    case 'temporary':
      return new TaskExecutionError('network_temporary', `${operation}暂时无法完成。`, {
        cause: error,
      });
    case 'cancelled':
      return new TaskExecutionError('cancelled', `${operation}已取消。`, { cause: error });
    case 'invalid_auth':
    case 'configuration':
      return new TaskExecutionError('invalid_config', `${operation}失败：模型配置或认证无效。`, {
        cause: error,
      });
    case 'invalid_output':
    case 'budget_exceeded':
      return new TaskExecutionError('validation_failed', `${operation}未生成符合要求的结果。`, {
        cause: error,
      });
    default:
      return new TaskExecutionError('permanent', `${operation}失败。`, { cause: error });
  }
}
