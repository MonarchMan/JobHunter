import { describe, expect, it, vi } from 'vitest';
import {
  SqliteMaintenanceService,
  sqliteMaintenancePolicy,
  type SqliteMaintenanceRepository,
  type SqliteMaintenanceState,
} from '../src/index.js';

const now = 2_000_000_000_000;
/** 使用纯端口样本验证阈值与冷却期，不依赖真实磁盘大小。 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- 保留 Vitest mock 的精确推导类型。
function fixture(state: Partial<SqliteMaintenanceState> = {}) {
  const space = {
    databaseBytes: 300 * 1024 * 1024,
    walBytes: 0,
    freeBytes: 100 * 1024 * 1024,
    freeRatio: 1 / 3,
  };
  const repository = {
    beginCheck: vi.fn(() => ({
      lastDailyAt: null,
      lastVacuumAt: null,
      vacuumPending: false,
      ...state,
    })),
    inspect: vi.fn(() => space),
    passiveCheckpoint: vi.fn(),
    optimize: vi.fn(() => true),
    maintain: vi.fn<SqliteMaintenanceRepository['maintain']>().mockResolvedValue('succeeded'),
    finishCheck: vi.fn(),
  } satisfies SqliteMaintenanceRepository;
  return { repository, space, service: new SqliteMaintenanceService(repository, () => now) };
}

describe('SQLite maintenance policy', () => {
  it('postpones busy statistics updates without advancing the daily clock', async () => {
    const { service, repository, space } = fixture();
    space.freeBytes = 0;
    repository.optimize.mockReturnValue(false);
    expect(await service.check()).toMatchObject({ outcome: 'skipped', reason: 'optimize_busy' });
    expect(repository.finishCheck).toHaveBeenCalledWith(
      expect.objectContaining({ lastDailyAt: null }),
    );
  });

  it('requires both free-space thresholds before vacuum', async () => {
    const { service, repository, space } = fixture();
    space.freeBytes = 63 * 1024 * 1024;
    await service.check();
    expect(repository.maintain).not.toHaveBeenCalled();
    space.freeBytes = 100 * 1024 * 1024;
    space.freeRatio = 0.24;
    await service.check();
    expect(repository.maintain).not.toHaveBeenCalled();
    space.freeRatio = 0.25;
    await service.check();
    expect(repository.maintain).toHaveBeenCalledWith('vacuum', now);
  });

  it('retains pending vacuum through cooldown and busy periods', async () => {
    const cooled = fixture({ lastVacuumAt: now - 1 });
    expect(await cooled.service.check()).toMatchObject({
      outcome: 'skipped',
      reason: 'vacuum_cooldown',
    });
    expect(cooled.repository.maintain).not.toHaveBeenCalled();
    const busy = fixture({
      lastDailyAt: now,
      vacuumPending: true,
      lastVacuumAt: now - sqliteMaintenancePolicy.vacuumCooldownMs,
    });
    busy.repository.maintain.mockResolvedValue('work_pending');
    await busy.service.check();
    expect(busy.repository.finishCheck).toHaveBeenCalledWith(
      expect.objectContaining({ vacuumPending: true }),
    );
  });

  it('uses passive before truncation and avoids a daily optimize on every poll', async () => {
    const { service, repository, space } = fixture({ lastDailyAt: now });
    space.walBytes = 64 * 1024 * 1024;
    await service.check();
    expect(repository.passiveCheckpoint).toHaveBeenCalledOnce();
    expect(repository.maintain).toHaveBeenCalledWith('truncate', now);
    expect(repository.optimize).not.toHaveBeenCalled();
  });

  it('does no work when the persistent check is not due', async () => {
    const { repository } = fixture();
    const service = new SqliteMaintenanceService({ ...repository, beginCheck: () => null });
    expect(await service.check()).toBeNull();
    expect(repository.inspect).not.toHaveBeenCalled();
  });

  it('records safe failure without advancing the successful vacuum cooldown', async () => {
    const { service, repository } = fixture();
    repository.maintain.mockRejectedValue(new Error('secret local path'));
    expect(await service.check()).toMatchObject({
      outcome: 'failed',
      reason: 'maintenance_failed',
    });
    expect(repository.finishCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        lastVacuumAt: null,
        vacuumPending: true,
      }),
    );
  });
});
