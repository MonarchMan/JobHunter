/** 通用 AI 对话记录；会话没有终止状态，消息独立记录生成结果。 */
export interface AiSession {
  readonly id: string;
  readonly type: 'interview' | 'chat';
  readonly title: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** 消息只保存当前内容；用户编辑通过时间戳进行并发校验。 */
export interface AiMessage {
  readonly id: string;
  readonly sessionId: string;
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly sequence: number;
  readonly status: 'pending' | 'completed' | 'failed' | 'cancelled';
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** 会话存储端口；事务回调只允许本地持久化，不包含模型调用。 */
export interface AiSessionRepository {
  transaction<T>(operation: () => T): T;
  list(): readonly AiSession[];
  get(id: string): AiSession | null;
  create(session: AiSession, metadata: Readonly<Record<string, string>>): void;
  metadata(sessionId: string): Readonly<Record<string, string>>;
  messages(sessionId: string): readonly AiMessage[];
  taskId(messageId: string): string | null;
  insert(message: AiMessage): void;
  edit(id: string, content: string, expectedUpdatedAt: number, now: number): boolean;
  finish(id: string, status: AiMessage['status'], content: string, now: number): boolean;
  delete(id: string): void;
}
