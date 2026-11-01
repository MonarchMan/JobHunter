import type { CurrentMatchPage, CurrentMatchQuery, MatchingRepository } from '../ports/matching.js';

/** Reads the current recommendation projection; historical results remain available by id. */
/** 查询当前简历版本下的职位匹配结果。 */
export class CurrentMatchQueryService {
  readonly #matching: MatchingRepository;

  public constructor(matching: MatchingRepository) {
    this.#matching = matching;
  }

  /** 返回当前匹配分页。 */
  public list(query: CurrentMatchQuery): CurrentMatchPage {
    return this.#matching.listCurrentMatches(query);
  }
}
