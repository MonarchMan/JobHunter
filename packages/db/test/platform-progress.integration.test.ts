import { expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  PlatformBrowsingService,
  WebPlatformService,
  TaskService,
  HandlerRegistry,
} from '@jobhunter/application';
import { PlatformError, type PlatformJobDetail } from '@jobhunter/platform-core';
import { SystemIdGenerator, utcInstant } from '@jobhunter/domain';
import { createTemporaryDataRoot } from '@jobhunter/testkit';
import {
  openSqliteDatabase,
  SqlitePlatformRepository,
  SqliteTaskRepository,
} from '../src/index.js';

it.each(['failed', 'cancelled'] as const)(
  '整批 %s 保留已提交进度，Web仅展示白名单，旧代次和跨平台不能覆写',
  async (status) => {
    const root = await createTemporaryDataRoot('platform-progress-');
    const db = openSqliteDatabase({ dataRoot: root.path });
    const repository = new SqlitePlatformRepository(db.client, 'liepin');
    const save = repository.save.bind(repository);
    const saved = vi.spyOn(repository, 'save').mockImplementation((...args) => {
      const id = save(...args);
      // 1、直接在事务提交后、应用下一步之前核验检查点与计数原子更新。
      const result: unknown = JSON.parse(
        String(db.client.prepare('SELECT result_json FROM tasks WHERE id=?').pluck().get(args[2])),
      );
      expect(result).toMatchObject({ progress: { saved: 1, processed: 1 } });
      expect(result).not.toHaveProperty('progress.currentExternalJobId');
      return id;
    });
    const ids = new SystemIdGenerator();
    const taskId = ids.generate();
    const controller = new AbortController();
    const candidate = (id: string): PlatformJobDetail => ({
      externalJobId: id,
      externalCompanyId: 'company',
      title: '开发工程师',
      company: '测试公司',
      city: '上海',
      salary: '',
      experience: '',
      education: '',
      sourceUrl: `https://www.liepin.com/job/${id}.shtml`,
      description: '参与软件开发和测试，完整的职位描述。',
    });
    const service = new PlatformBrowsingService(
      {
        connect: () =>
          Promise.resolve({
            disconnect: () => undefined,
            readNext: () =>
              Promise.resolve({
                candidates: [candidate('1'), candidate('2')],
                hasMore: true,
                skippedMissingCompanyId: 3,
              }),
            readDetail: (id) => {
              if (id === '2') {
                // 1、第一条职位和统计必须已原子提交，无需等待整批结束。
                expect(
                  JSON.parse(
                    String(
                      db.client
                        .prepare('SELECT result_json FROM tasks WHERE id=?')
                        .pluck()
                        .get(taskId),
                    ),
                  ),
                ).toMatchObject({ progress: { saved: 1, processed: 1 } });
                if (status === 'cancelled') controller.abort();
                else {
                  const error = new PlatformError('parse_changed', 123, 'detail_identity');
                  error.message = 'cookie=secret';
                  throw error;
                }
              }
              return Promise.resolve(candidate(id));
            },
          }),
      },
      repository,
      () => 1000,
    );
    try {
      await service.execute(
        { action: 'connect', portFile: '/fixture/DevToolsActivePort', targetId: 'private' },
        'connect',
        controller.signal,
      );
      db.client
        .prepare(
          `INSERT INTO tasks(id,task_type,payload_json,status,idempotency_key,max_attempts,available_at,created_at,lease_expires_at)
      VALUES (?,'platform.liepin',?,'running',?,1,0,0,10000)`,
        )
        .run(taskId, JSON.stringify({ action: 'next', generation: 1 }), randomUUID());
      await expect(
        service.execute({ action: 'next', generation: 1 }, taskId, controller.signal),
      ).rejects.toThrow();
      db.client
        .prepare('UPDATE tasks SET status=?,error_summary=? WHERE id=?')
        .run(status, 'cookie=secret', taskId);
      const tasks = new TaskService(
        { queue: new SqliteTaskRepository(db.client), clock: { now: () => utcInstant(1000) }, ids },
        new HandlerRegistry(),
      );
      const web = new WebPlatformService(repository, tasks, 'liepin');
      const snapshot = web.snapshot();
      expect(snapshot.task?.progress).toMatchObject({
        total: 2,
        saved: 1,
        processed: 1,
        skipped: 3,
        stage: 'detail',
        currentExternalJobId: '2',
        failure: { category: status === 'cancelled' ? 'cancelled' : 'parse_changed' },
      });
      expect(snapshot.task?.error).not.toContain('请检查 Chrome 登录');
      expect(JSON.stringify(snapshot)).not.toMatch(/secret|private|cookie/);
      expect(db.client.prepare('SELECT count(*) FROM jobs').pluck().get()).toBe(1);
      expect(saved).toHaveBeenCalledTimes(1);
      const progress = snapshot.task?.progress;
      if (!progress) throw new Error('Missing progress');
      // 2、过期代次及另一 provider 均不能覆盖当前统计；换代后旧进度不再投影。
      new SqlitePlatformRepository(db.client, 'boss').recordProgress(
        taskId,
        1,
        { ...progress, saved: 99 },
        1000,
      );
      repository.reset(1001);
      repository.recordProgress(taskId, 1, { ...progress, saved: 99 }, 1001);
      expect(web.snapshot().task?.progress).toBeNull();
      expect(
        JSON.parse(
          String(db.client.prepare('SELECT result_json FROM tasks WHERE id=?').pluck().get(taskId)),
        ),
      ).toMatchObject({ progress: { saved: 1 } });
    } finally {
      service.close();
      db.close();
      await root.cleanup();
    }
  },
);
