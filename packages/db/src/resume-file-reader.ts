import type { ResumeFileReader } from '@jobhunter/application';
import { open } from 'node:fs/promises';

/** 从本地路径读取简历文件，并限制访问范围。 */
export class NodeResumeFileReader implements ResumeFileReader {
  public async read(path: string, maximumBytes: number): Promise<Uint8Array> {
    const file = await open(path, 'r');
    try {
      const metadata = await file.stat();
      if (!metadata.isFile()) throw new TypeError('Resume path must identify a regular file.');
      if (metadata.size > maximumBytes) throw new TypeError('Resume file exceeds the size limit.');
      return new Uint8Array(await file.readFile());
    } finally {
      await file.close();
    }
  }
}
