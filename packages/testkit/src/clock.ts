/** Mutable deterministic clock for unit and integration tests. */
export class FakeClock {
  readonly #date: Date;

  public constructor(initial = '2026-01-01T00:00:00.000Z') {
    this.#date = new Date(initial);
    if (Number.isNaN(this.#date.valueOf()))
      throw new TypeError(`Invalid initial clock value: ${initial}`);
  }

  public now(): Date {
    return new Date(this.#date);
  }

  public advance(milliseconds: number): void {
    if (!Number.isSafeInteger(milliseconds))
      throw new TypeError('Clock advance must be an integer.');
    this.#date.setTime(this.#date.valueOf() + milliseconds);
  }
}
