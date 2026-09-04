import type { JobExportFileStore } from '@jobhunter/application';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** Writes an export through a same-directory temporary file and atomic rename. */
/** 将职位导出文件安全写入本地数据目录并提供读取。 */
export class NodeJobExportFileStore implements JobExportFileStore {
  public async writeAtomic(
    targetPath: string,
    content: string,
  ): Promise<{ readonly path: string; readonly bytes: number }> {
    const target = path.resolve(targetPath);
    const directory = path.dirname(target);
    await mkdir(directory, { recursive: true });
    const temporary = path.join(directory, `.${path.basename(target)}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
    return { path: target, bytes: Buffer.byteLength(content, 'utf8') };
  }
}
