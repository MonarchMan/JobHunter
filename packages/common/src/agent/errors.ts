import type { ModelUsage } from './model-client.js';
/** Agent 运行错误的稳定分类，用于重试策略和用户提示。 */
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

/** 模块使用的类型约束。 */
export type AgentErrorCategory = (typeof agentErrorCategories)[number];

/** 带分类和可重试标记的 Agent 运行时错误。 */
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

/** 模型客户端调用失败时使用的 Agent 错误子类。 */
export class ModelClientError extends AgentRuntimeError {
  /** 已发出的真实请求，即使调用失败也应保留在运行账本中。 */
  public usage?: ModelUsage;
  public constructor(category: AgentErrorCategory, message: string, retryable = false) {
    super(category, message, retryable);
    this.name = 'ModelClientError';
  }
}

/** 账本写入失败属于本地运行故障，不可误判为网络故障而重复消费。 */
export class ModelRequestPersistenceError extends AgentRuntimeError {
  public constructor() {
    super('configuration', 'Unable to persist model request ledger.');
    this.name = 'ModelRequestPersistenceError';
  }
}

/** 脱敏并截断错误摘要，避免日志泄露凭据或过长响应。 */
export function sanitizeAgentErrorSummary(summary: string): string {
  return summary
    .replaceAll(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]')
    .replaceAll(/(api[-_ ]?key|token|password|cookie)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replaceAll(/[\r\n\t]+/g, ' ')
    .replaceAll(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 300);
}

/** 将任意异常归一化为 Agent 运行时错误。 */
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
