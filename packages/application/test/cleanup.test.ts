import { describe, expect, it } from 'vitest';
import {
  CleanupService,
  type CleanupCandidate,
  type CleanupFileStore,
  type CleanupRepository,
} from '../src/index.js';

/** 构造测试输入或执行断言的辅助逻辑。 */
class FixtureRepository implements CleanupRepository {
  public candidates: CleanupCandidate[] = [];
  public registered: string[] = [];
  public readonly deleted: CleanupCandidate[] = [];

  public listCandidates(): readonly CleanupCandidate[] {
    return this.candidates;
  }
  /** 执行测试替身或时钟的操作。 */
  public listRegisteredArtifactPaths(): readonly string[] {
    return this.registered;
  }
  /** 执行测试替身或时钟的操作。 */
  public deleteCandidates(candidates: readonly CleanupCandidate[]): void {
    this.deleted.push(...candidates);
  }
}

/** 构造测试输入或执行断言的辅助逻辑。 */
class FixtureFiles implements CleanupFileStore {
  public files: { relativePath: string; bytes: number; modifiedAt: number }[] = [];
  public readonly removed: string[] = [];

  public listArtifactFiles(): ReturnType<CleanupFileStore['listArtifactFiles']> {
    return Promise.resolve(this.files);
  }
  /** 执行测试替身或时钟的操作。 */
  public remove(paths: readonly string[]): Promise<void> {
    this.removed.push(...paths);
    return Promise.resolve();
  }
}

const policy = { sourceDetailsDays: 30, observationsDays: 90, failedAgentRunsDays: 30 };
const dayMs = 24 * 60 * 60 * 1_000;

describe('cleanup planning and confirmation', () => {
  it('is dry-run by default and excludes unregistered files younger than 24 hours', async () => {
    const repository = new FixtureRepository();
    const files = new FixtureFiles();
    files.files = [
      { relativePath: 'artifacts/old', bytes: 10, modifiedAt: dayMs },
      { relativePath: 'artifacts/young', bytes: 20, modifiedAt: 2 * dayMs - 1 },
      { relativePath: 'artifacts/registered', bytes: 30, modifiedAt: dayMs },
    ];
    repository.registered = ['artifacts/registered'];
    const service = new CleanupService({ repository, files });
    const plan = await service.plan(policy, { now: 2 * dayMs });

    expect(plan.candidates).toMatchObject([
      { kind: 'orphan_file', relativePath: 'artifacts/old', bytes: 10 },
    ]);
    expect(repository.deleted).toEqual([]);
    expect(files.removed).toEqual([]);

    await expect(service.execute(plan.confirmationToken, { now: 2 * dayMs + 1 })).resolves.toEqual({
      deleted: 1,
      bytes: 10,
    });
    expect(files.removed).toEqual(['artifacts/old']);
  });

  it('does not expand a confirmed plan when new candidates appear', async () => {
    const repository = new FixtureRepository();
    const files = new FixtureFiles();
    const service = new CleanupService({ repository, files });
    const plan = await service.plan(policy, { now: 100 * dayMs });
    repository.candidates = [
      { kind: 'agent_run', id: 'new-candidate', relativePath: null, bytes: 0, createdAt: 1 },
    ];

    await expect(
      service.execute(plan.confirmationToken, { now: 100 * dayMs + 1 }),
    ).resolves.toEqual({
      deleted: 0,
      bytes: 0,
    });
    expect(repository.deleted).toEqual([]);
  });

  it('invalidates an orphan-file plan if the path becomes registered', async () => {
    const repository = new FixtureRepository();
    const files = new FixtureFiles();
    files.files = [{ relativePath: 'artifacts/old', bytes: 10, modifiedAt: 1 }];
    const service = new CleanupService({ repository, files });
    const plan = await service.plan(policy, { now: 100 * dayMs });
    repository.registered = ['artifacts/old'];

    await expect(service.execute(plan.confirmationToken, { now: 100 * dayMs + 1 })).rejects.toThrow(
      /changed after the dry-run/,
    );
    expect(files.removed).toEqual([]);
  });
});
