import { SqlitePlatformRepository, type SqliteDatabaseHandle } from '@jobhunter/db';
import { SystemIdGenerator } from '@jobhunter/domain';

/** 为统一职位查询提供三个完整平台职位；只操作调用方的隔离测试数据库。 */
export function seedPlatformJobs(database: SqliteDatabaseHandle): void {
  // 1、模拟持有有效租约的平台任务，复用真实仓储与身份规则。
  for (const provider of ['boss', 'zhilian'] as const) {
    const repository = new SqlitePlatformRepository(database.client, provider);
    const generation = repository.reset(1);
    const taskId = new SystemIdGenerator().generate();
    database.client
      .prepare(
        `INSERT INTO tasks
      (id,task_type,payload_json,status,idempotency_key,max_attempts,available_at,created_at,lease_expires_at)
      VALUES (?,?,'{}','running',?,1,0,0,10000)`,
      )
      .run(taskId, `platform.${provider}`, taskId);
    for (let index = 1; index <= (provider === 'boss' ? 2 : 1); index++) {
      repository.save(
        {
          externalJobId: `platform-fixture-${index}`,
          externalCompanyId: 'fixture-brand',
          title: `${provider === 'boss' ? 'BOSS' : '智联'} 平台工程师 ${index}`,
          company: `${provider} 平台测试公司`,
          city: '上海',
          salary: '',
          experience: '',
          education: '',
          sourceUrl:
            provider === 'boss'
              ? `https://www.zhipin.com/job_detail/fixture${index}.html`
              : `https://www.zhaopin.com/jobdetail/fixture${index}.htm`,
          description: '完整职位正文，参与系统设计与研发。',
        },
        generation,
        taskId,
        index,
      );
    }
    database.client.prepare("UPDATE tasks SET status='succeeded' WHERE id=?").run(taskId);
  }
}
