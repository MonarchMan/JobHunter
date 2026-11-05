import { AsyncLocalStorage } from 'node:async_hooks';

const messageContext = new AsyncLocalStorage<string>();
/** 对话调用将每次模型请求关联到同一 assistant 消息，不复制消息正文。 */
export function withModelMessage<T>(messageId: string, operation: () => T): T {
  return messageContext.run(messageId, operation);
}
/** 非对话调用返回空关联；上下文随异步调用链隔离。 */
export function currentModelMessage(): string | null {
  return messageContext.getStore() ?? null;
}
