import { parseContentHash, parseId } from '@jobhunter/domain';
import { isSourceError } from '@jobhunter/source-core';
import { z } from 'zod';
import type { TaskErrorCategory, TaskHandler } from '../tasks/model.js';
import { TaskExecutionError } from '../tasks/retry-policy.js';
import type { JobDetailService } from './job-detail-service.js';

export const sourceJobDetailTaskPayloadSchema = z
  .object({
    sourceId: z.string().trim().min(1),
    runId: z.string().trim().min(1),
    listContentHash: z.string().trim().min(1),
    adapterVersion: z.string().trim().min(1),
    discovered: z
      .object({
        externalJobId: z.string().min(1),
        sourceUrl: z.url({ protocol: /^https$/ }),
        raw: z.unknown(),
      })
      .strict(),
  })
  .strict();

function taskCategory(category: string): TaskErrorCategory {
  switch (category) {
    case 'temporary':
      return 'network_temporary';
    case 'rate_limited':
      return 'rate_limited';
    case 'invalid_config':
      return 'invalid_config';
    case 'parse_changed':
      return 'parse_changed';
    default:
      return 'permanent';
  }
}

export function createSourceJobDetailTaskHandler(
  service: Pick<JobDetailService, 'run'>,
): TaskHandler<z.infer<typeof sourceJobDetailTaskPayloadSchema>, void> {
  return {
    taskType: 'source.job-detail',
    payloadSchema: sourceJobDetailTaskPayloadSchema,
    outputSchema: {
      parse(value: unknown): void {
        if (value !== undefined) throw new TypeError('Detail task must not return a value.');
      },
    },
    defaultMaxAttempts: 3,
    leaseDurationMs: 2 * 60_000,
    concurrencyKey: (payload) =>
      `source-detail:${payload.sourceId}:${payload.discovered.externalJobId}`,
    async execute(context, payload) {
      try {
        await service.run(
          {
            sourceId: parseId(payload.sourceId, 'JobSource'),
            runId: parseId(payload.runId, 'SyncRun'),
            listContentHash: parseContentHash(payload.listContentHash),
            adapterVersion: payload.adapterVersion,
            discovered: payload.discovered,
          },
          context.signal,
        );
      } catch (error) {
        if (isSourceError(error)) {
          throw new TaskExecutionError(taskCategory(error.category), error.safeDiagnostic, {
            retryable: error.category === 'parse_changed',
            cause: error,
          });
        }
        throw error;
      }
    },
  };
}
