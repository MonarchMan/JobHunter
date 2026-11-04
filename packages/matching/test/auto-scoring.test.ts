import { describe, expect, it, vi } from 'vitest';
import { utcInstant, parseId, type JobId } from '@jobhunter/common/domain';
import type { EnqueueTaskCommand, EnqueueTaskResult } from '@jobhunter/common/tasks';
import type { MatchingRepository } from '../src/ports/matching.js';
import type { CandidateProfileReader } from '@jobhunter/user/contracts';
import {
  createAutoScoringOnSyncCompleted,
  type MatchingAutomationReader,
} from '../src/application/auto-scoring.js';

/** 构造测试输入或执行断言的辅助逻辑。 */
interface EnqueuedCall {
  readonly command: EnqueueTaskCommand;
}

/** 创建最小可用的匹配仓储替身，只暴露回调路径实际读取的方法。 */
function fakeMatching(jobStatus: 'active' | 'closed'): MatchingRepository {
  const revision = {
    id: parseId('018f0000-0000-7000-8000-0000000000a1', 'JobRevision'),
    jobId: parseId('018f0000-0000-7000-8000-0000000000b1', 'Job'),
    jobStatus,
    normalized: {},
    createdAt: utcInstant(1),
    lastSeenAt: utcInstant(1),
  };
  return {
    getLatestRevisionForJob: vi.fn((jobId: JobId) =>
      jobStatus === 'closed' ? null : { ...revision, jobId },
    ),
  } as unknown as MatchingRepository;
}

/** 创建带一个当前画像版本的资料读取替身。 */
function fakeProfiles(hasProfile: boolean): CandidateProfileReader {
  const profile = { id: parseId('018f0000-0000-7000-8000-0000000000c1', 'CandidateProfile') };
  const version = { id: parseId('018f0000-0000-7000-8000-0000000000d1', 'ProfileVersion') };
  return {
    listProfiles: () => (hasProfile ? [profile] : []),
    getProfile: () => (hasProfile ? profile : null),
    getCurrentVersion: () => (hasProfile ? version : null),
    getVersion: () => (hasProfile ? version : null),
  } as unknown as CandidateProfileReader;
}

/** 记录入队命令的任务服务替身接口。 */
interface FakeTaskService {
  readonly enqueue: (command: EnqueueTaskCommand) => EnqueueTaskResult;
}

/** 创建记录入队命令的任务服务替身。 */
function fakeTasks(calls: EnqueuedCall[]): FakeTaskService {
  return {
    enqueue: vi.fn((command: EnqueueTaskCommand): EnqueueTaskResult => {
      calls.push({ command });
      return { kind: 'enqueued', task: {} as never };
    }),
  };
}

/** 创建按给定值返回自动匹配设置的读取替身。 */
function automation(scoreEnabled: boolean, adviceEnabled: boolean): MatchingAutomationReader {
  return { readMatchingAutomation: () => ({ scoreEnabled, adviceEnabled }) };
}

const JOB_ID = '018f0000-0000-7000-8000-0000000000e1';

describe('auto scoring on sync completed', () => {
  function createHandler(input: {
    scoreEnabled: boolean;
    adviceEnabled: boolean;
    hasProfile?: boolean;
    jobStatus?: 'active' | 'closed';
  }): {
    callback: (completed: {
      status: 'succeeded' | 'partial' | 'failed' | 'cancelled';
      scorableJobIds: readonly string[];
    }) => void;
    calls: EnqueuedCall[];
  } {
    const calls: EnqueuedCall[] = [];
    const callback = createAutoScoringOnSyncCompleted({
      matching: fakeMatching(input.jobStatus ?? 'active'),
      profiles: fakeProfiles(input.hasProfile ?? true),
      tasks: fakeTasks(calls) as never,
      ids: { generate: () => '018f0000-0000-7000-8000-0000000000f1' },
      clock: { now: () => utcInstant(1) },
      automation: automation(input.scoreEnabled, input.adviceEnabled),
    });
    return { callback, calls };
  }

  it('enqueues two-stage scoring for each new revision when only scoring is enabled', () => {
    const { callback, calls } = createHandler({ scoreEnabled: true, adviceEnabled: false });
    callback({ status: 'succeeded', scorableJobIds: [JOB_ID] });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.command.taskType).toBe('match.score-job');
    // 自动评分开启即运行规则与模型两个阶段；建议开关不改变评分模式。
    expect(calls[0]?.command.payload).toMatchObject({ mode: 'llm' });
  });

  it('keeps the scoring mode independent from the advice switch', () => {
    const { callback, calls } = createHandler({ scoreEnabled: true, adviceEnabled: true });
    callback({ status: 'succeeded', scorableJobIds: [JOB_ID] });
    expect(calls[0]?.command.payload).toMatchObject({ mode: 'llm' });
  });

  it('does not enqueue when scoring is disabled', () => {
    const { callback, calls } = createHandler({ scoreEnabled: false, adviceEnabled: false });
    callback({ status: 'succeeded', scorableJobIds: [JOB_ID] });
    expect(calls).toHaveLength(0);
  });

  it('skips failed and cancelled runs entirely', () => {
    const { callback, calls } = createHandler({ scoreEnabled: true, adviceEnabled: false });
    callback({ status: 'failed', scorableJobIds: [JOB_ID] });
    callback({ status: 'cancelled', scorableJobIds: [JOB_ID] });
    expect(calls).toHaveLength(0);
  });

  it('scores partial runs that produced reliable new revisions', () => {
    const { callback, calls } = createHandler({ scoreEnabled: true, adviceEnabled: false });
    callback({ status: 'partial', scorableJobIds: [JOB_ID] });
    expect(calls).toHaveLength(1);
  });

  it('stops without enqueuing when there is no current profile', () => {
    const { callback, calls } = createHandler({
      scoreEnabled: true,
      adviceEnabled: false,
      hasProfile: false,
    });
    callback({ status: 'succeeded', scorableJobIds: [JOB_ID, JOB_ID] });
    expect(calls).toHaveLength(0);
  });

  it('skips jobs without a usable revision without failing the rest', () => {
    const { callback, calls } = createHandler({
      scoreEnabled: true,
      adviceEnabled: false,
      jobStatus: 'closed',
    });
    callback({ status: 'succeeded', scorableJobIds: [JOB_ID] });
    expect(calls).toHaveLength(0);
  });
});
