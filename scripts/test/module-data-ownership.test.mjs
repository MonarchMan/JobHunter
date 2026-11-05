import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../..', import.meta.url));

/** 扫描生产 TypeScript，排除测试、历史迁移和生成产物。 */
async function sourceFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await sourceFiles(target)));
    else if (entry.name.endsWith('.ts')) result.push(target);
  }
  return result;
}

/** SQL 表级所有权补充包级依赖门禁，防止同一 SQLite 绕过公开查询端口。 */
async function assertNoSql(module, verbs, tables) {
  const pattern = new RegExp(`\\b(?:${verbs})\\s+[\\x60"]?(?:${tables})\\b`, 'iu');
  for (const file of await sourceFiles(path.join(root, 'packages', module, 'src'))) {
    expect(await readFile(file, 'utf8'), path.relative(root, file)).not.toMatch(pattern);
  }
}

describe('four-module data ownership', () => {
  it('matching reads recruitment, user and common runtime facts through public ports', async () => {
    await assertNoSql(
      'matching',
      'FROM|JOIN|UPDATE|INTO|DELETE FROM',
      'jobs|companies|job_sources|candidate_profiles|profile_versions|agent_runs|tasks',
    );
  });

  it('common persistence contains no business repositories or business-table queries', async () => {
    await assertNoSql(
      'common',
      'FROM|JOIN|UPDATE|INTO|DELETE FROM',
      'jobs|job_observations|source_job_details|companies|job_sources|candidate_profiles|profile_versions|drill_turns|job_metadata',
    );
  });

  it('user lifecycle cleanup delegates foreign data mutations to their owners', async () => {
    await assertNoSql(
      'user',
      'FROM|JOIN|UPDATE|INTO|DELETE FROM',
      'jobs|companies|job_sources|job_metadata|agent_runs',
    );
  });

  it('recruitment uses owner participants for user and matching references', async () => {
    await assertNoSql(
      'recruitment',
      'FROM|JOIN|UPDATE|INTO|DELETE FROM',
      'candidate_profiles|profile_versions|files|file_entity_mappings|project_dossiers|drill_sessions|job_metadata',
    );
  });
});
