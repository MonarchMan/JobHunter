/** Small seeded PRNG for reproducible test data; it is not suitable for security tokens. */
export class SeededRandom {
  #state: number;

  public constructor(seed = 0x6d2b79f5) {
    this.#state = seed >>> 0;
  }

  public next(): number {
    let value = (this.#state += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  }

  public integer(minimum: number, maximumExclusive: number): number {
    if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximumExclusive)) {
      throw new TypeError('Random integer bounds must be safe integers.');
    }
    if (maximumExclusive <= minimum) throw new RangeError('Maximum must be greater than minimum.');
    return minimum + Math.floor(this.next() * (maximumExclusive - minimum));
  }
}
