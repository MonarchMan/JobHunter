import type {
  MatchAdviceRecord,
  MatchAdviceSelector,
  MatchingRepository,
} from '../ports/matching.js';
import type { MatchResultId } from '@jobhunter/domain';

/** 查询匹配结果对应的准备建议。 */
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

  /** 获取匹配结果最新建议。 */
  public current(matchResultId: MatchResultId): MatchAdviceRecord | null {
    return this.#matching.getCurrentAdvice(matchResultId, this.#selector);
  }
}
