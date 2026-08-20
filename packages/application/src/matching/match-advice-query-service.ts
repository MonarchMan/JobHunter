import type {
  MatchAdviceRecord,
  MatchAdviceSelector,
  MatchingRepository,
} from '../ports/matching.js';
import type { MatchResultId } from '@jobhunter/domain';

export class MatchAdviceQueryService {
  readonly #matching: MatchingRepository;
  readonly #selector: MatchAdviceSelector;

  public constructor(input: {
    readonly matching: MatchingRepository;
    readonly selector: MatchAdviceSelector;
  }) {
    this.#matching = input.matching;
    this.#selector = input.selector;
  }

  public current(matchResultId: MatchResultId): MatchAdviceRecord | null {
    return this.#matching.getCurrentAdvice(matchResultId, this.#selector);
  }
}
