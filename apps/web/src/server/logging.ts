import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadRuntimeAppConfig } from '@jobhunter/common/config/index';
import { createSafeLogger, type SafeLogger } from '@jobhunter/common/logging';

/** Next 开发热重载也复用同一写入者；不同进程使用不同文件，避免轮转竞争。 */
const state = globalThis as typeof globalThis & { __jobhunterWebLogger?: Promise<SafeLogger> };
export function getWebLogger(): Promise<SafeLogger> {
  return (state.__jobhunterWebLogger ??= (async () => {
    const config = await loadRuntimeAppConfig({
      workspaceRoot:
        process.env.JOBHUNTER_WORKSPACE_ROOT ?? path.resolve(import.meta.dirname, '../../../..'),
    });
    const hostRunId = randomUUID();
    return createSafeLogger({
      context: { component: 'web', hostRunId },
      level: config.logLevel.value,
      consoleLevel: config.consoleLogLevel?.value ?? 'warn',
      format: config.logFormat?.value ?? 'auto',
      logFile: path.join(
        config.bootstrap.dataRoot.value,
        'logs',
        `web-${String(process.pid)}-${hostRunId}.log`,
      ),
    });
  })().catch(() => createSafeLogger({ level: 'error', format: 'auto' })));
}
