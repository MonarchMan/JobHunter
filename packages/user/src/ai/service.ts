import { z } from 'zod';
import { contentHash, parseId, type Clock, type IdGenerator } from '@jobhunter/common/domain';
import type { TaskService } from '@jobhunter/common/tasks';
import type { CandidateProfileRepository } from '../ports/profiles.js';
import type { AiMessage, AiSession, AiSessionRepository } from '../ports/ai-sessions.js';

/** 会话边界严格限制类别和可选关联，项目位置不进入模型上下文。 */
export const createAiSessionSchema = z
  .object({
    type: z.enum(['interview', 'chat']),
    title: z.string().trim().min(1).max(160),
    profileId: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
  })
  .strict();
export const aiMessageTextSchema = z.string().trim().min(1).max(20_000);

/** 编排会话、当前画像关联和任务发布；不保存回答修订或派生知识。 */
export class AiSessionService {
  public constructor(
    private readonly input: {
      repository: AiSessionRepository;
      profiles: CandidateProfileRepository;
      tasks: TaskService;
      clock: Clock;
      ids: IdGenerator;
    },
  ) {}
  /** 列出用户的持续会话，不设归档或终止过滤。 */
  public list(): readonly AiSession[] {
    return this.input.repository.list();
  }
  /** 可选关联始终来自当前画像，不创建项目档案或快照。 */
  public projects(): readonly { profileId: string; projectId: string; name: string }[] {
    return this.input.profiles
      .listProfiles()
      .flatMap((profile) =>
        (this.input.profiles.getCurrentVersion(profile.id)?.effective.projects ?? []).flatMap(
          (project) =>
            project.id
              ? [{ profileId: profile.id, projectId: project.id, name: project.name }]
              : [],
        ),
      );
  }
  /** 汇总当前消息和可选关联，读取不会触发模型调用。 */
  public detail(id: string): {
    session: AiSession;
    messages: readonly AiMessage[];
    metadata: Readonly<Record<string, string>>;
  } {
    const session = this.input.repository.get(id);
    if (!session) throw new TypeError('AI session not found.');
    return {
      session,
      messages: this.input.repository.messages(id),
      metadata: this.input.repository.metadata(id),
    };
  }
  /** 校验画像和项目关系，原子建立会话和元数据。 */
  public create(value: z.infer<typeof createAiSessionSchema>): AiSession {
    const parsed = createAiSessionSchema.parse(value);
    const metadata: Record<string, string> = {};
    if (parsed.profileId) {
      const current = this.input.profiles.getCurrentVersion(
        parseId(parsed.profileId, 'CandidateProfile'),
      );
      if (!current) throw new TypeError('Profile not found.');
      metadata.profile_id = parsed.profileId;
      if (parsed.projectId) {
        if (!current.effective.projects.some((project) => project.id === parsed.projectId))
          throw new TypeError('Project not found.');
        metadata.project_id = parsed.projectId;
      }
    } else if (parsed.projectId) throw new TypeError('Project requires a profile.');
    const now = this.input.clock.now();
    const session: AiSession = {
      id: this.input.ids.generate(),
      type: parsed.type,
      title: parsed.title,
      createdAt: now,
      updatedAt: now,
    };
    this.input.repository.transaction(() => {
      this.input.repository.create(session, metadata);
    });
    return session;
  }
  /** 原子保存用户输入及助手占位消息并发布回复任务，重复分派不能留下孤儿消息。 */
  public send(sessionId: string, text: string): AiMessage {
    const content = aiMessageTextSchema.parse(text);
    return this.input.repository.transaction(() => {
      const detail = this.detail(sessionId);
      if (detail.messages.some((message) => message.status === 'pending'))
        throw new TypeError('Wait for the pending reply.');
      const now = this.input.clock.now();
      // 新一轮对话取代尚未成功的旧回复，避免旧任务重试插入迟到答案。
      for (const message of detail.messages.filter(
        (item) => item.status === 'failed' || item.status === 'cancelled',
      ))
        this.input.repository.finish(message.id, 'cancelled', '', now);
      const sequence = (detail.messages.at(-1)?.sequence ?? 0) + 1;
      this.input.repository.insert({
        id: this.input.ids.generate(),
        sessionId,
        role: 'user',
        content,
        sequence,
        status: 'completed',
        createdAt: now,
        updatedAt: now,
      });
      const reply: AiMessage = {
        id: this.input.ids.generate(),
        sessionId,
        role: 'assistant',
        content: '',
        sequence: sequence + 1,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      };
      this.input.repository.insert(reply);
      const queued = this.input.tasks.enqueue({
        taskType: 'ai.reply',
        payload: { sessionId, messageId: reply.id },
        idempotencyKey: `ai.reply:${reply.id}`,
      });
      if (queued.kind !== 'enqueued') throw new TypeError('Reply task could not be published.');
      return reply;
    });
  }
  /** 仅允许覆盖用户消息；时间戳冲突拒绝保存，关联执行立即撤销。 */
  public edit(
    sessionId: string,
    messageId: string,
    content: string,
    expectedUpdatedAt: number,
  ): void {
    this.input.repository.transaction(() => {
      if (
        !this.detail(sessionId).messages.some(
          (message) => message.id === messageId && message.role === 'user',
        )
      )
        throw new TypeError('User message not found.');
      if (
        !this.input.repository.edit(
          messageId,
          aiMessageTextSchema.parse(content),
          expectedUpdatedAt,
          this.input.clock.now(),
        )
      )
        throw new TypeError('Message changed; reload before editing.');
      // 编辑立即撤销对应执行，提交门控负责拒绝已经在途的迟到写入。
      for (const message of this.detail(sessionId).messages.filter(
        (item) => item.status === 'cancelled',
      )) {
        const taskId = this.input.repository.taskId(message.id);
        if (taskId) this.input.tasks.cancel(parseId(taskId, 'Task'));
      }
    });
  }
  /** 先取消仍在执行的回复，再删除会话；模型账本保持独立。 */
  public delete(id: string): void {
    this.input.repository.transaction(() => {
      for (const message of this.detail(id).messages.filter(
        (item) => item.status === 'pending' || item.status === 'failed',
      )) {
        const taskId = this.input.repository.taskId(message.id);
        if (taskId) this.input.tasks.cancel(parseId(taskId, 'Task'));
      }
      this.input.repository.delete(id);
    });
  }
  /** 每次调用只读取当前事实和当前消息；项目删除后退化为无项目对话。 */
  public context(
    sessionId: string,
    messageId: string,
  ): {
    value: {
      type: AiSession['type'];
      project: unknown;
      messages: { role: AiMessage['role']; content: string }[];
    };
    hash: string;
  } {
    const detail = this.detail(sessionId);
    const target = detail.messages.find(
      (message) => message.id === messageId && message.role === 'assistant',
    );
    if (!target || target.status === 'cancelled') throw new TypeError('Reply is no longer valid.');
    const profileId = detail.metadata.profile_id;
    const current = profileId
      ? this.input.profiles.getCurrentVersion(parseId(profileId, 'CandidateProfile'))
      : null;
    const project = current?.effective.projects.find(
      (item) => item.id === detail.metadata.project_id,
    );
    const value = {
      type: detail.session.type,
      project: project
        ? {
            name: project.name,
            role: project.role,
            highlights: project.highlights,
            startDate: project.startDate,
            endDate: project.endDate,
          }
        : null,
      messages: detail.messages
        .filter((message) => message.sequence < target.sequence && message.status === 'completed')
        .map(({ role, content }) => ({ role, content })),
    };
    return { value, hash: contentHash({ value, updatedAt: detail.session.updatedAt }) };
  }
  /** 返回后的校验和提交同属短事务，防止模型迟到覆盖编辑后的输入。 */
  public complete(sessionId: string, messageId: string, hash: string, content: string): boolean {
    return this.input.repository.transaction(() => {
      const target = this.detail(sessionId).messages.find((message) => message.id === messageId);
      if (!target || target.status === 'cancelled') return false;
      if (this.context(sessionId, messageId).hash !== hash) {
        this.input.repository.finish(messageId, 'cancelled', '', this.input.clock.now());
        return false;
      }
      return this.input.repository.finish(messageId, 'completed', content, this.input.clock.now());
    });
  }
  /** 失败只更新回复状态，不把异常或输入正文写入消息。 */
  public fail(messageId: string): void {
    this.input.repository.finish(messageId, 'failed', '', this.input.clock.now());
  }

  /** 重试开始时恢复生成状态；已被编辑或替代的消息不能重新生成。 */
  public prepareReply(sessionId: string, messageId: string): void {
    this.input.repository.transaction(() => {
      const message = this.detail(sessionId).messages.find((item) => item.id === messageId);
      if (!message || message.status === 'cancelled')
        throw new TypeError('Reply is no longer valid.');
      if (message.status === 'failed')
        this.input.repository.finish(messageId, 'pending', '', this.input.clock.now());
    });
  }
}
