import { describe, expect, it, vi, type Mock } from 'vitest';
import { z } from 'zod';
import type { TaskHandlerContext } from '@jobhunter/common/tasks';
import { TaskExecutionError } from '@jobhunter/common/tasks';
import type {
  SyncScoringProgress,
  SyncScoringStage,
} from '@jobhunter/recruitment/contracts/sync-scoring';
import { createSyncScoringStage } from '../src/application/sync-job-scoring.js';
import type { createManualJobScoreTaskHandler } from '../src/application/manual-job-score-handler.js';
import { manualJobScoreTaskPayloadSchema } from '../src/application/manual-job-score-handler.js';

const silentLogger = {
  info(event: string): void {
    void event;
  },
  warn(event: string): void {
    void event;
  },
  error(event: string): void {
    void event;
  },
};

const makeContext = (): TaskHandlerContext => ({
  signal: new AbortController().signal,
  clock: { now: () => 1 as never },
  logger: silentLogger,
  services: {},
});

const noopCheckpoint = (): void => undefined;

const profile = { id: '018f0000-0000-7000-8200-000000000201', name: 'P' };
const version = {
  id: '018f0000-0000-7000-8200-000000000202',
  profileId: '018f0000-0000-7000-8200-000000000201',
};

const jobA = '018f0000-0000-7000-8200-000000000101';
const jobB = '018f0000-0000-7000-8200-000000000102';

type StageInput = Parameters<typeof createSyncScoringStage>[0];

function makeAutomation(scoreEnabled = true, adviceEnabled = false): StageInput['automation'] {
  return {
    readMatchingAutomation: () => ({ scoreEnabled, adviceEnabled }),
  };
}

function makeMatching(revision?: { id: string; jobStatus: string }): StageInput['matching'] {
  return {
    getLatestRevisionForJob: vi.fn(() => revision ?? null),
  } as never;
}

type SingleScoringHandler = ReturnType<typeof createManualJobScoreTaskHandler>;
/** 完整评分处理器夹具，保留强类型 Mock 供调用断言使用。 */
type SingleScoringMock = Omit<SingleScoringHandler, 'execute'> & {
  readonly execute: Mock<SingleScoringHandler['execute']>;
};

function makeSingle(result?: {
  matchResultId: string;
  matchAdviceId: string | null;
  modelScoreMissing: boolean | null;
}): SingleScoringMock {
  return {
    taskType: 'match.score-job',
    payloadSchema: manualJobScoreTaskPayloadSchema,
    outputSchema: z.object({
      mode: z.enum(['rules', 'llm']),
      matchResultId: z.string(),
      matchAdviceId: z.string().nullable(),
      modelScoreMissing: z.boolean().nullable(),
      agentRunId: z.string().nullable(),
    }),
    defaultMaxAttempts: 3,
    leaseDurationMs: 300000,
    retryPayload: (payload: unknown) => payload,
    execute: vi.fn<SingleScoringHandler['execute']>((_context, input) => {
      const parsed = manualJobScoreTaskPayloadSchema.parse(input);
      return Promise.resolve({
        mode: parsed.mode,
        matchResultId: result?.matchResultId ?? 'mr-1',
        matchAdviceId: result?.matchAdviceId ?? null,
        modelScoreMissing: result?.modelScoreMissing ?? null,
        agentRunId: null,
      });
    }),
  };
}

function makeStage(input: {
  readonly matching?: StageInput['matching'];
  readonly singleScoring?: ReturnType<typeof createManualJobScoreTaskHandler>;
  readonly automation?: StageInput['automation'];
}): SyncScoringStage {
  return createSyncScoringStage({
    matching: input.matching ?? makeMatching({ id: 'rev-1', jobStatus: 'active' }),
    profiles: {
      listProfiles: () => [profile],
      getCurrentVersion: () => version,
    } as never,
    singleScoring: input.singleScoring ?? makeSingle(),
    automation: input.automation ?? makeAutomation(),
  });
}

describe('createSyncScoringStage', () => {
  it('skips the whole stage when the scoring switch is off', async () => {
    const stage = makeStage({ automation: makeAutomation(false) });
    const outcome = await stage.run({
      context: makeContext(),
      jobIds: [jobA],
      previous: null,
      checkpoint: noopCheckpoint,
    });
    expect(outcome).toEqual({ kind: 'skipped', reason: 'disabled' });
  });

  it('skips the whole stage when no current profile exists', async () => {
    const stage = createSyncScoringStage({
      matching: makeMatching({ id: 'rev-1', jobStatus: 'active' }),
      profiles: { listProfiles: () => [], getCurrentVersion: () => null } as never,
      singleScoring: makeSingle(),
      automation: makeAutomation(),
    });
    const outcome = await stage.run({
      context: makeContext(),
      jobIds: [jobA],
      previous: null,
      checkpoint: noopCheckpoint,
    });
    expect(outcome).toEqual({ kind: 'skipped', reason: 'no_profile' });
  });

  it('scores each job serially and reports degraded count', async () => {
    const single = makeSingle({
      matchResultId: 'mr-1',
      matchAdviceId: null,
      modelScoreMissing: true,
    });
    const stage = makeStage({ singleScoring: single });
    const checkpoints: SyncScoringProgress[] = [];
    const outcome = await stage.run({
      context: makeContext(),
      jobIds: [jobA, jobB],
      previous: null,
      checkpoint: (progress) => {
        checkpoints.push(progress);
      },
    });
    expect(outcome.kind).toBe('completed');
    if (outcome.kind !== 'completed') throw new Error('Expected completed outcome.');
    expect(outcome.progress.items).toHaveLength(2);
    expect(outcome.progress.degraded).toBe(2);
    expect(checkpoints).toHaveLength(2);
    const calls = vi.mocked(single.execute).mock.calls;
    expect(calls[0]?.[1]).toMatchObject({ requireModelScore: false, mode: 'llm' });
  });

  it('resumes by skipping previously succeeded items', async () => {
    const single = makeSingle({
      matchResultId: 'mr-2',
      matchAdviceId: null,
      modelScoreMissing: null,
    });
    const stage = makeStage({ singleScoring: single });
    const outcome = await stage.run({
      context: makeContext(),
      jobIds: [jobA, jobB],
      previous: {
        items: [
          {
            jobId: jobA,
            status: 'succeeded' as const,
            result: { matchResultId: 'mr-1', matchAdviceId: null, degraded: false },
            error: null,
          },
        ],
        degraded: 0,
      },
      checkpoint: noopCheckpoint,
    });
    expect(outcome.kind).toBe('completed');
    if (outcome.kind !== 'completed') throw new Error('Expected completed outcome.');
    expect(vi.mocked(single.execute)).toHaveBeenCalledTimes(1);
    expect(outcome.progress.items[0]?.result).toMatchObject({ matchResultId: 'mr-1' });
  });

  it('marks missing revision or closed job as failed and continues', async () => {
    const matching = {
      getLatestRevisionForJob: vi.fn((id: string) =>
        id === jobA ? { id: 'rev-x', jobStatus: 'closed' } : null,
      ),
    } as never;
    const single = makeSingle();
    const stage = makeStage({ matching, singleScoring: single });
    const outcome = await stage.run({
      context: makeContext(),
      jobIds: [jobA, jobB],
      previous: null,
      checkpoint: noopCheckpoint,
    });
    expect(outcome.kind).toBe('completed');
    if (outcome.kind !== 'completed') throw new Error('Expected completed outcome.');
    expect(outcome.progress.items.every((item) => item.status === 'failed')).toBe(true);
    expect(vi.mocked(single.execute)).not.toHaveBeenCalled();
  });

  it.each([
    new TaskExecutionError('invalid_config', 'model configuration', { retryable: false }),
    new TaskExecutionError('network_temporary', 'network temporarily unavailable'),
    Object.assign(new Error('no such column: sensitive_column'), { code: 'SQLITE_ERROR' }),
    new Error('internal fixture failure'),
  ])('preserves item classification and retry policy: %s', async (failure) => {
    const single = {
      ...makeSingle(),
      execute: vi
        .fn<ReturnType<typeof createManualJobScoreTaskHandler>['execute']>()
        .mockRejectedValue(failure),
    };
    const stage = makeStage({ singleScoring: single });
    const context = makeContext();
    const errorLog = vi.fn<TaskHandlerContext['logger']['error']>();
    const outcome = await stage.run({
      context: { ...context, logger: { ...context.logger, error: errorLog } },
      jobIds: [jobA],
      previous: null,
      checkpoint: noopCheckpoint,
    });
    if (outcome.kind !== 'completed') throw new Error('Missing progress');
    const item = outcome.progress.items[0];
    expect(item).toMatchObject({
      status: 'failed',
      errorCategory:
        failure instanceof TaskExecutionError
          ? failure.category
          : 'code' in failure
            ? 'invalid_config'
            : 'permanent',
      retryable: failure instanceof TaskExecutionError && failure.category === 'network_temporary',
    });
    expect(JSON.stringify(item)).not.toContain('sensitive_column');
    expect(errorLog).toHaveBeenCalledTimes(1);
    const [event, fields] = errorLog.mock.calls[0] ?? [];
    expect(event).toBe('matching.score_item_failed');
    expect(fields?.jobId).toBe(jobA);
    expect(fields?.error).toMatchObject({
      cause: failure instanceof TaskExecutionError ? failure.cause : failure,
    });
  });

  it('throws cancelled with progress when signal aborts mid-stage', async () => {
    const controller = new AbortController();
    const single = makeSingle();
    const stage = makeStage({ singleScoring: single });
    await expect(
      stage.run({
        context: {
          ...makeContext(),
          signal: controller.signal,
        },
        jobIds: [jobA, jobB],
        previous: null,
        checkpoint: () => {
          controller.abort();
        },
      }),
    ).rejects.toBeInstanceOf(TaskExecutionError);
  });
});
