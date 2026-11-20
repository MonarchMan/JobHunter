import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PlatformProviderKey } from '../contracts/index.js';
import type { PlatformResponseDiagnostic } from '../application/response-diagnostics.js';

/** 每次失败写独立的本地日志文件，权限仅授予运行用户。 */
export async function writePlatformResponseLog(
  dataRoot: string,
  taskId: string,
  provider: PlatformProviderKey,
  response: PlatformResponseDiagnostic,
): Promise<void> {
  const directory = path.join(dataRoot, 'logs', 'platform-responses');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(
    path.join(directory, `${randomUUID()}.json`),
    JSON.stringify({ taskId, provider, recordedAt: new Date().toISOString(), ...response }) + '\n',
    { flag: 'wx', mode: 0o600 },
  );
}
