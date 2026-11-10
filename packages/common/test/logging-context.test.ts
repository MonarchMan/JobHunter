import { describe, expect, it } from 'vitest';
import { createSafeLogger, logDiagnostic, withLogContext } from '../src/logging/index.js';
import { withTaskExecution } from '../src/tasks/contracts/execution-scope.js';

it('isolates concurrent task identities and inherits nested agent identity', async () => {
  const records: Record<string, unknown>[] = [];
  const logger = createSafeLogger({
    stderr: { write: (line) => records.push(JSON.parse(line) as Record<string, unknown>) },
  });
  await Promise.all(
    ['first', 'second'].map((taskId) =>
      withTaskExecution(
        { taskId, attempt: 2, owner: 'fixture', now: Date.now, logger },
        async () => {
          await Promise.resolve();
          await withLogContext({ agentRunId: `agent-${taskId}` }, async () => {
            await Promise.resolve();
            logDiagnostic('info', 'nested');
          });
          logDiagnostic('info', 'outer');
        },
      ),
    ),
  );
  expect(
    records.filter((row) => row.event === 'nested').map((row) => [row.taskId, row.agentRunId]),
  ).toEqual([
    ['first', 'agent-first'],
    ['second', 'agent-second'],
  ]);
  expect(
    records
      .filter((row) => row.event === 'outer')
      .every((row) => row.agentRunId === undefined && row.attempt === 2),
  ).toBe(true);
});

describe('console warning aggregation', () => {
  it('preserves all file events and reports the suppressed console count on close', async () => {
    const lines: string[] = [];
    const logger = createSafeLogger({ stderr: { write: (line) => lines.push(line) } });
    for (let index = 0; index < 20; index++) logger.warn('worker.queue_busy');
    await logger.close();
    expect(lines).toHaveLength(2);
    expect((JSON.parse(lines[1] ?? '{}') as Record<string, unknown>).suppressed).toBe(19);
  });
});
