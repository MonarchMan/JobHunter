import type { ResearchDelivery } from '../ports/research-delivery.js';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const maximumBytes = 2 * 1024 * 1024;

/** 按任务分配结果目录；拒绝符号链接、目录逃逸和超过限制的文件。 */
export class NodeResearchDelivery implements ResearchDelivery {
  private readonly root: string;

  public constructor(dataRoot: string) {
    this.root = path.resolve(dataRoot, 'research-results');
  }

  /** 位置由系统生成，不使用客户端提供的路径。 */
  public location(taskId: string): string {
    return path.join(this.root, z.uuid().parse(taskId), 'result.json');
  }

  /** 先建立交付目录，外部 Agent 可在该目录临时写入后原子改名。 */
  public async prepare(taskId: string): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await this.checkDirectory(this.root);
    const directory = path.dirname(this.location(taskId));
    await mkdir(directory, { recursive: true });
    await this.checkDirectory(directory);
  }

  /** 打开后检查同一文件描述符，限量读取防止并发追加突破大小约束。 */
  public async read(taskId: string): Promise<Uint8Array> {
    await this.prepare(taskId);
    const handle = await open(
      this.location(taskId),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size < 1 || stat.size > maximumBytes) {
        throw new TypeError('研究结果必须是非空普通文件，且不超过 2 MiB。');
      }
      const buffer = Buffer.alloc(maximumBytes + 1);
      let size = 0;
      while (size < buffer.length) {
        const result = await handle.read(buffer, size, buffer.length - size, size);
        if (!result.bytesRead) break;
        size += result.bytesRead;
      }
      if (size < 1 || size > maximumBytes) throw new TypeError('研究结果文件大小无效。');
      return buffer.subarray(0, size);
    } finally {
      await handle.close();
    }
  }

  /** 系统执行器同样通过文件交付；临时文件写完后原子发布。 */
  public async write(taskId: string, content: Uint8Array): Promise<void> {
    if (content.byteLength < 1 || content.byteLength > maximumBytes)
      throw new TypeError('研究结果文件大小无效。');
    await this.prepare(taskId);
    const target = this.location(taskId);
    const temporary = `${target}.${randomUUID()}.tmp`;
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(content);
      await handle.sync();
      await this.checkDirectory(path.dirname(target));
      await rename(temporary, target);
    } finally {
      await handle.close();
      await rm(temporary, { force: true });
    }
  }

  /** 同时校验根目录和任务目录，禁止链接替换到其他位置。 */
  private async checkDirectory(directory: string): Promise<void> {
    const stat = await lstat(directory);
    const canonicalRoot = await realpath(this.root);
    const canonical = await realpath(directory);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (await lstat(this.root)).isSymbolicLink() ||
      (canonical !== canonicalRoot && path.dirname(canonical) !== canonicalRoot)
    ) {
      throw new TypeError('研究结果目录必须位于本地交付目录内，不能使用符号链接。');
    }
  }
}
