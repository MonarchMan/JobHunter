import { z } from 'zod';
import { AgentRuntimeError } from './errors.js';

export const evaluationCaseSchema = z
  .object({
    id: z.string().trim().min(1),
    inputRef: z.string().trim().min(1),
    assertions: z.array(
      z
        .object({
          path: z.string().trim().min(1),
          operator: z.enum(['equals', 'contains', 'exists']),
          expected: z.unknown().optional(),
        })
        .strict(),
    ),
  })
  .strict();

export const evaluationReportSchema = z
  .object({
    agentKey: z.string().trim().min(1),
    agentVersion: z.string().trim().min(1),
    promptVersion: z.string().trim().min(1),
    modelConfigHash: z.string().length(64),
    startedAt: z.number().int().nonnegative(),
    finishedAt: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    passed: z.number().int().nonnegative(),
    providerFailures: z.number().int().nonnegative(),
    schemaFailures: z.number().int().nonnegative(),
    qualityFailures: z.number().int().nonnegative(),
    cases: z.array(
      z
        .object({
          id: z.string(),
          status: z.enum(['passed', 'provider_failed', 'schema_failed', 'quality_failed']),
          failedAssertions: z.array(z.string()),
        })
        .strict(),
    ),
  })
  .strict()
  .refine(
    (report) =>
      report.passed + report.providerFailures + report.schemaFailures + report.qualityFailures ===
        report.total && report.cases.length === report.total,
    'Evaluation totals must include every case exactly once.',
  );

export type EvaluationCase = z.infer<typeof evaluationCaseSchema>;
export type EvaluationReport = z.infer<typeof evaluationReportSchema>;

function valueAtPath(value: unknown, path: string): unknown {
  const segments = path
    .split('/')
    .slice(1)
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'));
  let current = value;
  for (const segment of segments) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Readonly<Record<string, unknown>>)[segment];
  }
  return current;
}

export function evaluateAssertions(
  output: unknown,
  assertions: EvaluationCase['assertions'],
): readonly string[] {
  const failures: string[] = [];
  for (const assertion of assertions) {
    const actual = valueAtPath(output, assertion.path);
    const passed =
      assertion.operator === 'exists'
        ? actual !== undefined
        : assertion.operator === 'contains'
          ? (typeof actual === 'string' &&
              typeof assertion.expected === 'string' &&
              actual.includes(assertion.expected)) ||
            (Array.isArray(actual) && actual.includes(assertion.expected))
          : Object.is(actual, assertion.expected);
    if (!passed) failures.push(`${assertion.path}:${assertion.operator}`);
  }
  return failures;
}

export async function runEvaluation<TInput>(input: {
  readonly agentKey: string;
  readonly agentVersion: string;
  readonly promptVersion: string;
  readonly modelConfigHash: string;
  readonly cases: readonly EvaluationCase[];
  readonly loadInput: (inputRef: string) => Promise<TInput>;
  readonly invoke: (value: TInput) => Promise<unknown>;
  readonly now?: () => number;
}): Promise<EvaluationReport> {
  const now = input.now ?? Date.now;
  const startedAt = now();
  const results: EvaluationReport['cases'][number][] = [];
  for (const evaluationCase of input.cases) {
    try {
      const value = await input.loadInput(evaluationCase.inputRef);
      const output = await input.invoke(value);
      const failures = evaluateAssertions(output, evaluationCase.assertions);
      results.push({
        id: evaluationCase.id,
        status: failures.length === 0 ? 'passed' : 'quality_failed',
        failedAssertions: [...failures],
      });
    } catch (error) {
      const schemaFailure =
        error instanceof AgentRuntimeError && error.category === 'invalid_output';
      results.push({
        id: evaluationCase.id,
        status: schemaFailure ? 'schema_failed' : 'provider_failed',
        failedAssertions: [],
      });
    }
  }
  const report: EvaluationReport = {
    agentKey: input.agentKey,
    agentVersion: input.agentVersion,
    promptVersion: input.promptVersion,
    modelConfigHash: input.modelConfigHash,
    startedAt,
    finishedAt: now(),
    total: results.length,
    passed: results.filter((result) => result.status === 'passed').length,
    providerFailures: results.filter((result) => result.status === 'provider_failed').length,
    schemaFailures: results.filter((result) => result.status === 'schema_failed').length,
    qualityFailures: results.filter((result) => result.status === 'quality_failed').length,
    cases: results,
  };
  return evaluationReportSchema.parse(report);
}
