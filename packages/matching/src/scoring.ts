import type { DeterministicMatchInput, DeterministicMatchOutput } from './model.js';
import { calculateOverlappingMatch } from './overlapping-scoring.js';

/** 始终执行当前岗位、地点和资格条件规则，不再提供历史算法选择。 */
export function calculateDeterministicMatch(
  input: DeterministicMatchInput,
): DeterministicMatchOutput {
  return calculateOverlappingMatch(input);
}
