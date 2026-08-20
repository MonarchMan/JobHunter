import { openSqliteDatabase } from '@jobhunter/db';
import { createTemporaryDataRoot } from '@jobhunter/testkit';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runLocalCli, type CliIo } from '../src/index.js';

function memoryIo(): { readonly io: CliIo; readonly stdout: string[]; readonly stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      stdout: { write: (value) => void stdout.push(value) },
      stderr: { write: (value) => void stderr.push(value) },
    },
  };
}

async function command(
  dataRoot: string,
  argv: readonly string[],
): Promise<{
  readonly exitCode: number;
  readonly body: Record<string, unknown>;
  readonly stderr: string;
}> {
  const output = memoryIo();
  const exitCode = await runLocalCli({
    argv: ['--json', '--data-root', dataRoot, ...argv],
    io: output.io,
    environment: {},
  });
  return {
    exitCode,
    body: JSON.parse(output.stdout.join('')) as Record<string, unknown>,
    stderr: output.stderr.join(''),
  };
}

function seedJobs(dataRoot: string): void {
  const database = openSqliteDatabase({ dataRoot });
  try {
    const insert = database.client.prepare(`
      INSERT INTO jobs
        (id, company_id, source_id, external_job_id, title, department, job_family,
         locations_json, employment_type, experience_text, education_text, description,
         detail_url, apply_url, status, missing_count, content_hash, first_seen_at,
         last_seen_at, created_at, updated_at)
      VALUES
        (?, '018f0000-0000-7000-8000-000000000101',
         '018f0000-0000-7000-8000-000000000201', ?, ?, '大模型平台', '研发',
         ?, '全职', '3 年', '本科', ?, ?, ?, ?, 0, ?, 1, 2, 1, ?)`);
    insert.run(
      '018f0000-0000-7000-8000-000000000401',
      'cli-job-1',
      'Agent 开发工程师',
      '["北京"]',
      '建设 Agent 平台',
      'https://careers.tencent.com/job/1',
      'https://careers.tencent.com/apply/1',
      'active',
      'hash-1',
      3,
    );
    insert.run(
      '018f0000-0000-7000-8000-000000000402',
      'cli-job-2',
      '大模型应用工程师',
      '["深圳"]',
      '开发大模型应用',
      'https://careers.tencent.com/job/2',
      'https://careers.tencent.com/apply/2',
      'stale',
      'hash-2',
      2,
    );
    insert.run(
      '018f0000-0000-7000-8000-000000000403',
      'cli-job-3',
      '历史算法工程师',
      '["上海"]',
      '已关闭职位',
      'https://careers.tencent.com/job/3',
      'https://careers.tencent.com/apply/3',
      'closed',
      'hash-3',
      1,
    );
  } finally {
    database.close();
  }
}

describe('job commands', () => {
  it('filters, paginates, shows and exports jobs without showing closed jobs by default', async () => {
    const root = await createTemporaryDataRoot('jobhunter-cli-jobs-');
    const dataRoot = path.join(root.path, '中文 数据');
    try {
      expect((await command(dataRoot, ['init'])).exitCode).toBe(0);
      seedJobs(dataRoot);

      const human = memoryIo();
      expect(
        await runLocalCli({
          argv: ['--data-root', dataRoot, 'job', 'list', '--limit', '1'],
          io: human.io,
          environment: {},
        }),
      ).toBe(0);
      expect(human.stdout.join('')).toContain('ID\t公司\t状态\t分数\t职位\t地点');
      expect(human.stderr).toEqual([]);

      const first = await command(dataRoot, [
        'job',
        'list',
        '--company',
        'tencent',
        '--limit',
        '1',
      ]);
      expect(first.exitCode).toBe(0);
      expect(first.stderr).toBe('');
      const firstData = first.body as {
        readonly data: {
          readonly items: readonly { readonly status: string }[];
          readonly nextCursor: string;
        };
      };
      expect(firstData.data.items).toHaveLength(1);
      expect(firstData.data.items[0]?.status).not.toBe('closed');
      expect(firstData.data.nextCursor).toBeTruthy();

      const second = await command(dataRoot, [
        'job',
        'list',
        '--limit',
        '1',
        '--cursor',
        firstData.data.nextCursor,
      ]);
      expect(second.exitCode).toBe(0);

      const closed = await command(dataRoot, ['job', 'list', '--status', 'closed']);
      expect(closed.body).toMatchObject({
        ok: true,
        data: { items: [{ id: '018f0000-0000-7000-8000-000000000403', status: 'closed' }] },
      });

      const shown = await command(dataRoot, [
        'job',
        'show',
        '018f0000-0000-7000-8000-000000000401',
      ]);
      expect(shown.body).toMatchObject({
        ok: true,
        data: { job: { companyName: '腾讯', description: '建设 Agent 平台' } },
      });

      const csvPath = path.join(root.path, '导出 结果', '职位.csv');
      const exported = await command(dataRoot, [
        'job',
        'export',
        csvPath,
        '--format',
        'csv',
        '--bom',
      ]);
      expect(exported.exitCode).toBe(0);
      expect(exported.body).toMatchObject({ ok: true, data: { count: 2, path: csvPath } });
      const csv = await readFile(csvPath, 'utf8');
      expect(csv.startsWith('\uFEFF"id"')).toBe(true);
      expect(csv).toContain('Agent 开发工程师');
      expect(csv).not.toContain('历史算法工程师');

      const jsonPath = path.join(root.path, '导出 结果', '职位.json');
      expect(
        (
          await command(dataRoot, [
            'job',
            'export',
            jsonPath,
            '--format',
            'json',
            '--location',
            '北京',
          ])
        ).body,
      ).toMatchObject({ ok: true, data: { count: 1, path: jsonPath } });
      const json = JSON.parse(await readFile(jsonPath, 'utf8')) as {
        readonly jobs: readonly { readonly title: string }[];
      };
      expect(json.jobs.map((item) => item.title)).toEqual(['Agent 开发工程师']);

      const missing = await command(dataRoot, [
        'job',
        'show',
        '018f0000-0000-7000-8000-000000009999',
      ]);
      expect(missing.exitCode).toBe(3);
      expect(missing.body).toMatchObject({ ok: false, error: { code: 'JOB_NOT_FOUND' } });
    } finally {
      await root.cleanup();
    }
  });
});
