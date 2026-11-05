import { describe, expect, it, vi } from 'vitest';
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

function makeSingle(result?: {
  matchResultId: string;
  matchAdviceId: string | null;
  modelScoreMissing: boolean | null;
}): ReturnType<typeof createManualJobScoreTaskHandler> {
  return {
    retryPayload: (payload: unknown) => payload,
    execute: vi.fn((_context: unknown, input: unknown) => {
      const parsed = manualJobScoreTaskPayloadSchema.parse(input);
      return Promise.resolve({
        mode: parsed.mode,
        matchResultId: result?.matchResultId ?? 'mr-1',
        matchAdviceId: result?.matchAdviceId ?? null,
        modelScoreMissing: result?.modelScoreMissing ?? null,
      });
    }),
  } as never;
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
    const calls = (single as { execute: ReturnType<typeof vi.fn> }).execute.mock.calls;
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
    expect((single as { execute: ReturnType<typeof vi.fn> }).execute).toHaveBeenCalledTimes(1);
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
    expect((single as { execute: ReturnType<typeof vi.fn> }).execute).not.toHaveBeenCalled();
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
