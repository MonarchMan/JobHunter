import { describe, expect, it, vi } from 'vitest';
import { utcInstant } from '@jobhunter/domain';
import { createManualJobScoreTaskHandler } from '../src/matching/manual-job-score-handler.js';
import { createJobAdviceTaskHandler } from '../src/matching/job-advice-handler.js';
import { createJobUnderstandingTaskHandler } from '../src/matching/job-understanding-handler.js';
import { createMatchRevisionTaskHandler } from '../src/matching/matching-handlers.js';
import { TaskExecutionError } from '../src/tasks/retry-policy.js';

describe('manual scoring stage recovery', () => {
  it('preserves scoring and resumes only advice after failure', async () => {
    const matchResultId = '018f0000-0000-7000-8000-000000000001';
    const understanding = {
      ...createJobUnderstandingTaskHandler({ unavailable: true }),
      execute: vi.fn().mockResolvedValue({ jobEnrichmentId: 'enrichment' }),
    };
    const matching = {
      ...createMatchRevisionTaskHandler(null),
      execute: vi.fn().mockResolvedValue({ matchResultId }),
    };
    const advice = {
      ...createJobAdviceTaskHandler({ unavailable: true }),
      execute: vi
        .fn()
        .mockRejectedValueOnce(
          new TaskExecutionError('validation_failed', '建议生成失败：引用校验未通过。'),
        )
        .mockResolvedValue({ matchAdviceId: 'advice' }),
    };
    const handler = createManualJobScoreTaskHandler({ understanding, matching, advice });
    const payload = {
      jobRevisionId: 'revision',
      profileVersionId: 'profile',
      mode: 'llm' as const,
    };
    const context = {
      signal: new AbortController().signal,
      clock: { now: () => utcInstant(1) },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      services: {},
    };
    const error: unknown = await handler.execute(context, payload).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(TaskExecutionError);
    if (!(error instanceof TaskExecutionError)) throw new Error('Expected stage failure.');
    expect(error.safeSummary).toContain('评分完成，建议生成失败');
    expect(error.result).toMatchObject({
      scoringStatus: 'succeeded',
      adviceStatus: 'failed',
      matchResultId,
    });
    const retry = handler.payloadSchema.parse(handler.retryPayload?.(payload, error.result));
    expect(await handler.execute(context, retry)).toMatchObject({
      matchResultId,
      matchAdviceId: 'advice',
    });
    expect(understanding.execute).toHaveBeenCalledTimes(1);
    expect(matching.execute).toHaveBeenCalledTimes(1);
    expect(advice.execute).toHaveBeenCalledTimes(2);
    expect(
      handler.retryPayload?.({ ...payload, profileVersionId: 'another' }, error.result),
    ).not.toHaveProperty('resumeMatchResultId');
  });
});
