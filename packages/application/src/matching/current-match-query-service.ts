import type { CurrentMatchPage, CurrentMatchQuery, MatchingRepository } from '../ports/matching.js';

/** Reads the current recommendation projection; historical results remain available by id. */
export class CurrentMatchQueryService {
  readonly #matching: MatchingRepository;

  public constructor(matching: MatchingRepository) {
    this.#matching = matching;
  }

  public list(query: CurrentMatchQuery): CurrentMatchPage {
    return this.#matching.listCurrentMatches(query);
  }
}
