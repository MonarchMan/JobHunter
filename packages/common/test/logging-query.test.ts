import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { queryLogFiles } from '../src/logging/index.js';

describe('bounded diagnostic timeline', () => {
  it('merges rotated and web logs, filters identities and redacts exported records', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jobhunter-query-'));
    try {
      await mkdir(join(root, 'logs'));
      const row = (time: string, taskId: string): string =>
        JSON.stringify({ time, taskId, event: 'fixture', token: 'private', level: 30 });
      await writeFile(
        join(root, 'logs/jobhunter.log.1'),
        `${row('2026-11-10T01:00:00Z', 'a')}\ninvalid\n`,
      );
      await writeFile(join(root, 'logs/jobhunter.log'), `${row('2026-11-10T03:00:00Z', 'b')}\n`);
      await writeFile(join(root, 'logs/web-123-abcd.log'), `${row('2026-11-10T02:00:00Z', 'a')}\n`);
      await writeFile(join(root, 'private.txt'), row('2026-11-10T04:00:00Z', 'a'));
      await symlink(join(root, 'private.txt'), join(root, 'logs/jobhunter.log.2'));
      const result = await queryLogFiles(root, { taskId: 'a' });
      expect(result.events.map((event) => event.time)).toEqual([
        '2026-11-10T01:00:00Z',
        '2026-11-10T02:00:00Z',
      ]);
      expect(JSON.stringify(result)).not.toContain('private');
      expect(result.skippedLines).toBe(1);
      const limited = await queryLogFiles(root, { limit: 1 });
      expect(limited.events).toHaveLength(1);
      expect(limited.truncated).toBe(true);
      await expect(queryLogFiles(root, { limit: 1001 })).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
