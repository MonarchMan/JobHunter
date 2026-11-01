import type { SqliteDatabaseHandle } from '@jobhunter/common/persistence/connection';
import { utcInstant } from '@jobhunter/common/domain';
import { SqliteRecruitmentDashboardReader } from '@jobhunter/recruitment/persistence/dashboard-reader';
import { SqliteMatchingDashboardReader } from '@jobhunter/matching/persistence/dashboard-reader';
import { SqliteProfileIdentityReader } from '@jobhunter/user/persistence/profile-identity-reader';
import { SqliteTaskRepository } from '@jobhunter/common/persistence/tasks';
import { DashboardSnapshotReader } from './read-model.js';

/** 首页所需查询适配器的入口装配；模块之间只传递公开查询能力。 */
export function createDashboardReadModel(
  client: SqliteDatabaseHandle['client'],
): DashboardSnapshotReader {
  const profiles = new SqliteProfileIdentityReader(client);
  const tasks = new SqliteTaskRepository(client);
  return new DashboardSnapshotReader(
    new SqliteRecruitmentDashboardReader(client),
    new SqliteMatchingDashboardReader(client, profiles),
    profiles,
    { summary: () => tasks.summary(utcInstant(Date.now())) },
  );
}
