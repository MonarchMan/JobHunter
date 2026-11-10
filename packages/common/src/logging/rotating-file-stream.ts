import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Writable } from 'node:stream';

/** 按字节上限滚动写入日志文件的 Writable。 */
export class RotatingFileStream extends Writable {
  readonly #path: string;
  readonly #maxBytes: number;
  readonly #maxFiles: number;
  #descriptor: number | undefined;
  #bytes: number;

  /** 执行模块组件对外暴露的操作。 */
  public constructor(input: {
    readonly path: string;
    readonly maxBytes: number;
    readonly maxFiles: number;
  }) {
    super();
    if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes < 1024)
      throw new TypeError('Log rotation maxBytes is invalid.');
    if (!Number.isSafeInteger(input.maxFiles) || input.maxFiles < 1 || input.maxFiles > 100)
      throw new TypeError('Log rotation maxFiles is invalid.');
    this.#path = resolve(input.path);
    this.#maxBytes = input.maxBytes;
    this.#maxFiles = input.maxFiles;
    mkdirSync(dirname(this.#path), { recursive: true, mode: 0o700 });
    this.#descriptor = openSync(this.#path, 'a', 0o600);
    this.#bytes = statSync(this.#path).size;
  }

  /** 写入一块日志并在超过上限时滚动文件。 */
  public override _write(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    try {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
      if (this.#bytes > 0 && this.#bytes + buffer.length > this.#maxBytes) this.#rotate();
      if (this.#descriptor === undefined) throw new Error('Log stream is closed');
      let offset = 0;
      while (offset < buffer.length) {
        const written = writeSync(this.#descriptor, buffer, offset);
        if (written <= 0) throw new Error('Log file write made no progress');
        offset += written;
      }
      this.#bytes += buffer.length;
      callback();
    } catch (error) {
      callback(error instanceof Error ? error : new Error('Log file write failed.'));
    }
  }

  /** 在流结束时关闭当前文件句柄。 */
  public override _final(callback: (error?: Error | null) => void): void {
    try {
      if (this.#descriptor !== undefined) closeSync(this.#descriptor);
      this.#descriptor = undefined;
      callback();
    } catch (error) {
      callback(error instanceof Error ? error : new Error('Log close failed'));
    }
  }

  /** 写入失败或显式 destroy 时同样归还文件描述符。 */
  public override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    try {
      if (this.#descriptor !== undefined) closeSync(this.#descriptor);
    } catch {
      /* 原始写入错误优先。 */
    }
    this.#descriptor = undefined;
    callback(error);
  }

  #rotate(): void {
    if (this.#descriptor !== undefined) closeSync(this.#descriptor);
    this.#descriptor = undefined;
    const oldest = `${this.#path}.${String(this.#maxFiles)}`;
    if (existsSync(oldest)) unlinkSync(oldest);
    for (let index = this.#maxFiles - 1; index >= 1; index -= 1) {
      const source = `${this.#path}.${String(index)}`;
      if (existsSync(source)) renameSync(source, `${this.#path}.${String(index + 1)}`);
    }
    if (existsSync(this.#path)) renameSync(this.#path, `${this.#path}.1`);
    this.#descriptor = openSync(this.#path, 'a', 0o600);
    this.#bytes = 0;
  }
}
