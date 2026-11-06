import { describe, expect, it, vi } from 'vitest';
import { utcInstant } from '@jobhunter/common/domain';
import { createManualJobScoreTaskHandler } from '../src/application/manual-job-score-handler.js';
import { createMatchRevisionTaskHandler } from '../src/application/matching-handlers.js';
import { createJobAnalysis } from '../src/application/job-analysis.js';
const context = {
  signal: new AbortController().signal,
  clock: { now: () => utcInstant(1) },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  services: {},
};
describe('unified job scoring', () => {
  it.each(['rules', 'llm'] as const)(
    'freezes %s scoring and advice switches into one analysis call',
    async (mode) => {
      for (const enabled of [false, true]) {
        const analysis = {
          ...createJobAnalysis({ unavailable: true }),
          analyze: vi.fn().mockResolvedValue({
            jobEnrichmentId: null,
            fitScore: mode === 'llm' ? 80 : null,
            fitReasons: ['匹配'],
            advice: null,
            agentRunId: null,
          }),
          storeAdvice: vi.fn().mockReturnValue(enabled ? 'advice' : null),
        };
        const matching = {
          ...createMatchRevisionTaskHandler(null),
          execute: vi.fn().mockResolvedValue({ matchResultId: 'match' }),
        };
        const handler = createManualJobScoreTaskHandler({
          analysis,
          matching,
          adviceEnabled: () => enabled,
        });
        const output = await handler.execute(context, {
          mode,
          jobRevisionId: 'job',
          profileVersionId: 'profile',
        });
        expect(analysis.analyze).toHaveBeenCalledTimes(1);
        expect(analysis.analyze).toHaveBeenCalledWith(context, {
          jobRevisionId: 'job',
          profileVersionId: 'profile',
          score: mode === 'llm',
          advice: enabled,
        });
        expect(output.matchAdviceId).toBe(enabled ? 'advice' : null);
      }
    },
  );
  it('skips model work when all sections are disabled', async () => {
    expect(
      await createJobAnalysis({ unavailable: true }).analyze(context, {
        jobRevisionId: 'job',
        profileVersionId: 'profile',
        score: false,
        advice: false,
      }),
    ).toMatchObject({ fitScore: null, advice: null });
  });
  it('does not publish a score when the unified analysis fails', async () => {
    const analysis = {
      ...createJobAnalysis({ unavailable: true }),
      analyze: vi.fn().mockRejectedValue(new Error('analysis failed')),
    };
    const matching = { ...createMatchRevisionTaskHandler(null), execute: vi.fn() };
    await expect(
      createManualJobScoreTaskHandler({ analysis, matching, adviceEnabled: () => true }).execute(
        context,
        { mode: 'llm', jobRevisionId: 'job', profileVersionId: 'profile' },
      ),
    ).rejects.toThrow('analysis failed');
    expect(matching.execute).not.toHaveBeenCalled();
  });
});
