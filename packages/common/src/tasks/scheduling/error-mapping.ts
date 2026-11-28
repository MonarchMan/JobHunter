import type { AgentRuntimeError } from '@jobhunter/common/agent';
import type { TaskErrorCategory } from '../contracts/errors.js';
import { TaskExecutionError } from './retry-policy.js';

/** 每项定义业务操作名称后的提示，以及调度使用的错误类别。 */
const agentTaskErrors: Partial<
  Record<AgentRuntimeError['category'], readonly [TaskErrorCategory, string]>
> = {
  rate_limited: ['rate_limited', '失败：模型请求触发限流。'],
  timeout: ['network_temporary', '失败：模型请求超时。'],
  temporary: ['network_temporary', '暂时无法完成。'],
  cancelled: ['cancelled', '已取消。'],
  invalid_auth: ['invalid_config', '失败：模型配置或认证无效。'],
  configuration: ['invalid_config', '失败：模型配置或认证无效。'],
  invalid_output: ['validation_failed', '未生成符合要求的结果。'],
  budget_exceeded: ['validation_failed', '未生成符合要求的结果。'],
};

/** 将 Agent 运行分类映射为任务队列可执行的重试策略。 */
export function mapAgentRuntimeError(
  error: AgentRuntimeError,
  operation: string,
): TaskExecutionError {
  const [category, message] = agentTaskErrors[error.category] ?? ['permanent', '失败。'];
  return new TaskExecutionError(category, `${operation}${message}`, { cause: error });
}
