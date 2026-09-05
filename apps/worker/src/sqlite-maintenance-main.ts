import { SqliteMaintenanceService } from '@jobhunter/application';
import { SqliteMaintenanceRepository } from '@jobhunter/db';
import path from 'node:path';

// 1、仅接受主进程传入的绝对数据库路径，独立进程持有专用维护连接。
const databasePath = process.argv[2];
if (!databasePath || !path.isAbsolute(databasePath)) throw new Error('Missing database path');
const repository = new SqliteMaintenanceRepository(databasePath);
try {
  // 2、服务检查持久化时钟和阈值，输出经过应用 Schema 校验的安全摘要。
  const summary = await new SqliteMaintenanceService(repository).check();
  process.stdout.write(JSON.stringify(summary));
} finally {
  // 3、异常也释放连接；若进程被强制结束，其他连接依据 PID 识别失效标记。
  repository.close();
}
