import {
  CleanupService,
  type CleanupDataParticipant,
  type AgentReferenceReader,
} from '../../operations/cleanup-service.js';
import { createCleanupTaskHandler } from '../../operations/cleanup-handler.js';
import { SqliteCleanupRepository, DataRootCleanupFileStore } from '../../persistence/cleanup.js';
import type { TaskRuntimeContext, TaskCapability } from '../host/runtime.js';
/** 通用清理机制由各所有者注入候选和引用保护，不读取业务事实表。 */
export function createCleanupTasks(
  context: TaskRuntimeContext,
  input: {
    readonly participants: readonly CleanupDataParticipant[];
    readonly references: readonly AgentReferenceReader[];
  },
): TaskCapability {
  // 1、同连接装配参与者，清理任务仍由公共引擎执行。
  context.registry.register(
    createCleanupTaskHandler({
      cleanup: new CleanupService({
        repository: new SqliteCleanupRepository(
          context.database.client,
          input.participants,
          input.references,
        ),
        files: new DataRootCleanupFileStore(context.dataRoot),
      }),
    }),
  );
  return { close: () => Promise.resolve() };
}
