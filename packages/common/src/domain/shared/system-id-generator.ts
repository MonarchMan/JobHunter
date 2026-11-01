import { randomBytes } from 'node:crypto';
import type { IdGenerator } from './id.js';

/** 使用毫秒时间和安全随机数生成 RFC 9562 UUIDv7 标识符。 */
export class SystemIdGenerator implements IdGenerator {
  readonly #now: () => number;
  readonly #random: (bytes: number) => Uint8Array;

  public constructor(
    input: { readonly now?: () => number; readonly random?: (bytes: number) => Uint8Array } = {},
  ) {
    this.#now = input.now ?? Date.now;
    this.#random = input.random ?? randomBytes;
  }

  /** 执行模块组件对外暴露的操作。 */
  public generate(): string {
    // 1、校验时间和随机源，再按 UUIDv7 布局写入 16 字节缓冲区。
    const timestamp = this.#now();
    if (!Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp > 0xffffffffffff) {
      throw new TypeError('UUIDv7 timestamp is outside the supported range.');
    }
    const random = this.#random(10);
    if (random.byteLength !== 10)
      throw new TypeError('UUIDv7 random source returned invalid bytes.');
    const bytes = new Uint8Array(16);
    let remaining = timestamp;
    for (let index = 5; index >= 0; index -= 1) {
      bytes[index] = remaining % 256;
      remaining = Math.floor(remaining / 256);
    }
    bytes[6] = 0x70 | ((random[0] ?? 0) & 0x0f);
    bytes[7] = random[1] ?? 0;
    bytes[8] = 0x80 | ((random[2] ?? 0) & 0x3f);
    bytes.set(random.subarray(3), 9);
    const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
}
