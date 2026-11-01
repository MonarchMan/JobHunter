/** Mutable deterministic clock for unit and integration tests. */
/** 可控的测试时钟，避免测试依赖真实时间。 */
export class FakeClock {
  readonly #date: Date;

  public constructor(initial = '2026-01-01T00:00:00.000Z') {
    this.#date = new Date(initial);
    if (Number.isNaN(this.#date.valueOf()))
      throw new TypeError(`Invalid initial clock value: ${initial}`);
  }

  /** 返回当前测试时间。 */
  public now(): Date {
    return new Date(this.#date);
  }

  /** 将测试时间向前推进指定毫秒数。 */
  public advance(milliseconds: number): void {
    if (!Number.isSafeInteger(milliseconds))
      throw new TypeError('Clock advance must be an integer.');
    this.#date.setTime(this.#date.valueOf() + milliseconds);
  }
}
