import { candidateProfileSchema, normalizedJobSchema } from '@jobhunter/domain';
import { z } from 'zod';
import { jobUnderstandingSchema } from './job-understanding.js';
import { jobAdviceSchema, parseJobAdviceAgentOutput } from './job-advice-agent.js';
import { calculateDeterministicMatch } from './scoring.js';

const goldenJobSchema = z
  .object({
    job: normalizedJobSchema,
    company: z
      .object({
        sizeCategory: z.enum(['large', 'medium', 'other']).nullable(),
        industry: z.string().trim().min(1).nullable(),
      })
      .strict(),
    understanding: jobUnderstandingSchema.nullable(),
    relevant: z.boolean(),
    mustNotExclude: z.boolean(),
  })
  .strict();

/** 匹配黄金样例 Schema。 */
export const matchingGoldenCaseSchema = z
  .object({
    id: z.string().trim().min(1),
    profile: candidateProfileSchema,
    jobs: z.array(goldenJobSchema).min(1),
    adviceSamples: z
      .array(
        z
          .object({
            externalJobId: z.string().trim().min(1),
            output: jobAdviceSchema,
          })
          .strict(),
      )
      .default([]),
  })
  .strict();

/** 模块使用的类型约束。 */
export type MatchingGoldenCase = z.infer<typeof matchingGoldenCaseSchema>;

/** 模块数据结构或契约。 */
export interface MatchingEvaluationMetrics {
  readonly topK: number;
  readonly topKRelevant: number;
  readonly topKRelevantRate: number;
  readonly falseExclusions: number;
  readonly adviceSamples: number;
  readonly factConsistentAdvice: number;
  readonly adviceFactConsistencyRate: number;
}

/** 执行一组黄金样例并汇总匹配准确性指标。 */
export function evaluateMatchingGoldenCase(
  value: unknown,
  options: { readonly topK?: number } = {},
): MatchingEvaluationMetrics {
  const evaluationCase = matchingGoldenCaseSchema.parse(value);
  const topK = options.topK ?? 10;
  if (!Number.isSafeInteger(topK) || topK < 1) throw new TypeError('Evaluation topK is invalid.');
  const evaluated = evaluationCase.jobs.map((item) => ({
    item,
    match: calculateDeterministicMatch({
      profile: evaluationCase.profile,
      job: item.job,
      company: item.company,
      understanding: item.understanding,
    }),
  }));
  const ranked = evaluated
    .filter(({ match }) => match.filterStatus !== 'excluded')
    .toSorted(
      (left, right) =>
        right.match.totalScore - left.match.totalScore ||
        left.item.job.externalJobId.localeCompare(right.item.job.externalJobId),
    )
    .slice(0, topK);
  let factConsistentAdvice = 0;
  for (const sample of evaluationCase.adviceSamples) {
    const target = evaluated.find(({ item }) => item.job.externalJobId === sample.externalJobId);
    if (!target) throw new TypeError(`Advice sample job does not exist: ${sample.externalJobId}.`);
    try {
      parseJobAdviceAgentOutput(sample.output, {
        profile: evaluationCase.profile,
        job: target.item.job,
        match: target.match,
      });
      factConsistentAdvice += 1;
    } catch {
      // Invalid samples remain in the denominator so the report exposes factual regressions.
    }
  }
  const adviceSamples = evaluationCase.adviceSamples.length;
  return {
    topK,
    topKRelevant: ranked.filter(({ item }) => item.relevant).length,
    topKRelevantRate:
      ranked.length === 0 ? 0 : ranked.filter(({ item }) => item.relevant).length / ranked.length,
    falseExclusions: evaluated.filter(
      ({ item, match }) => item.mustNotExclude && match.filterStatus === 'excluded',
    ).length,
    adviceSamples,
    factConsistentAdvice,
    adviceFactConsistencyRate: adviceSamples === 0 ? 1 : factConsistentAdvice / adviceSamples,
  };
}
