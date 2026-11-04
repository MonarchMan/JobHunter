import { describe, expect, it, vi } from 'vitest';
import { utcInstant } from '@jobhunter/common/domain';
import { TaskExecutionError, type TaskHandlerContext } from '@jobhunter/common/tasks';
import { createBatchJobScoreTaskHandler } from '../src/application/batch-job-score-handler.js';
import { createManualJobScoreTaskHandler } from '../src/application/manual-job-score-handler.js';
import { createJobUnderstandingTaskHandler } from '../src/application/job-understanding-handler.js';
import { createJobAdviceTaskHandler } from '../src/application/job-advice-handler.js';
import { createMatchRevisionTaskHandler } from '../src/application/matching-handlers.js';

const first = '018f0000-0000-7000-8000-000000000001';
const second = '018f0000-0000-7000-8000-000000000002';
const profile = '018f0000-0000-7000-8000-000000000003';
const payload = {
  jobRevisionIds: [first, second],
  profileVersionId: profile,
  mode: 'llm' as const,
};

/** 构造真实阶段编排及可控失败，验证批次不会重复成功阶段。 */
function fixture(): {
  handler: ReturnType<typeof createBatchJobScoreTaskHandler>;
  context: TaskHandlerContext & { checkpoint: ReturnType<typeof vi.fn> };
  understanding: { execute: ReturnType<typeof vi.fn> };
  matching: { execute: ReturnType<typeof vi.fn> };
  advice: { execute: ReturnType<typeof vi.fn> };
} {
  const understanding = {
    ...createJobUnderstandingTaskHandler({ unavailable: true }),
    execute: vi.fn().mockResolvedValue({
      jobEnrichmentId: null,
      fitScore: 80,
      fitReasons: [],
      agentRunId: null,
      cacheHit: false,
    }),
  };
  const matching = {
    ...createMatchRevisionTaskHandler(null),
    execute: vi
      .fn()
      .mockResolvedValueOnce({ matchResultId: first })
      .mockResolvedValue({ matchResultId: second }),
  };
  const advice = {
    ...createJobAdviceTaskHandler({ unavailable: true }),
    execute: vi
      .fn()
      .mockResolvedValueOnce({ matchAdviceId: first })
      .mockRejectedValueOnce(new TaskExecutionError('validation_failed', '建议生成失败'))
      .mockResolvedValue({ matchAdviceId: second }),
  };
  const single = createManualJobScoreTaskHandler({
    understanding,
    matching,
    advice,
    adviceEnabled: () => true,
  });
  const handler = createBatchJobScoreTaskHandler(single);
  const context = {
    signal: new AbortController().signal,
    clock: { now: () => utcInstant(1) },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    services: {},
    checkpoint: vi.fn(),
  };
  return { handler, context, understanding, matching, advice };
}

describe('batch scoring checkpoints', () => {
  it('skips successful jobs and retries only advice after its failure', async () => {
    const { handler, context, understanding, matching, advice } = fixture();
    const error: unknown = await handler.execute(context, payload).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(TaskExecutionError);
    if (!(error instanceof TaskExecutionError)) throw new Error('Expected failure');
    expect(context.checkpoint).toHaveBeenCalledTimes(2);
    const retry = handler.payloadSchema.parse(handler.retryPayload?.(payload, error.result));
    const result = await handler.execute(context, retry);
    expect(result.items.map((item) => item.status)).toEqual(['succeeded', 'succeeded']);
    expect(understanding.execute).toHaveBeenCalledTimes(2);
    expect(matching.execute).toHaveBeenCalledTimes(2);
    expect(advice.execute).toHaveBeenCalledTimes(3);
  });

  it('resumes saved progress after interruption without repeating successful jobs', async () => {
    const { handler, context, understanding } = fixture();
    context.checkpoint.mockImplementationOnce(() => {
      throw new Error('simulated worker stop');
    });
    await expect(handler.execute(context, payload)).rejects.toThrow('worker stop');
    const progress: unknown = context.checkpoint.mock.calls[0]?.[0];
    const retry = handler.payloadSchema.parse(handler.retryPayload?.(payload, progress));
    await handler.execute(context, retry).catch(() => undefined);
    expect(understanding.execute).toHaveBeenCalledTimes(2);
  });

  it('does not mark a model failure as completed rules-only scoring', async () => {
    const { handler, context, understanding, matching } = fixture();
    understanding.execute.mockResolvedValue({
      jobEnrichmentId: null,
      fitScore: null,
      fitReasons: [],
      agentRunId: null,
      cacheHit: false,
    });
    await expect(handler.execute(context, payload)).rejects.toMatchObject({
      result: {
        items: [
          expect.objectContaining({ status: 'failed' }),
          expect.objectContaining({ status: 'failed' }),
        ],
      },
    });
    expect(matching.execute).not.toHaveBeenCalled();
  });
});
