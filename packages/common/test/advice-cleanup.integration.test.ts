import Database from 'better-sqlite3';
import { readFile } from 'node:fs/promises';
import { contentHash } from '@jobhunter/common/domain';
import { expect, it } from 'vitest';

it('removes legacy advice references and resume emphasis while retaining text and valid hashes', async () => {
  const db = new Database(':memory:');
  try {
    db.exec(
      'CREATE TABLE match_advices (result_json TEXT, content_hash TEXT); CREATE TABLE agent_runs (agent_key TEXT, output_json TEXT, output_hash TEXT);',
    );
    db.function('migration_json_hash', (value: string) =>
      contentHash(JSON.parse(value) as unknown),
    );
    db.function('migration_regexp_replace', (value: string, pattern: string, replacement: string) =>
      value.replace(new RegExp(pattern, 'gi'), replacement).trim(),
    );
    const old = JSON.stringify({
      highlights: [
        { text: '项目匹配（ref-1）', references: [{ kind: 'evidence', value: '旧证据' }] },
      ],
      gaps: [{ text: '补充 SQL [ref-2, ref-3]', references: ['ref-2'] }],
      uncertainties: [],
      resumeEmphasis: ['删除'],
      preparation: ['准备案例 ref-1'],
    });
    db.prepare('INSERT INTO match_advices VALUES (?, ?)').run(old, 'old-hash');
    db.prepare('INSERT INTO agent_runs VALUES (?, ?, ?)').run('job-advice', old, 'old-hash');
    db.prepare('INSERT INTO agent_runs VALUES (?, ?, ?)').run('other', old, 'untouched');
    const sql = await readFile(
      new URL('../migrations/legacy/0047_remove_advice_references.sql', import.meta.url),
      'utf8',
    );
    db.exec(sql);
    const expected = {
      highlights: [{ text: '项目匹配' }],
      gaps: [{ text: '补充 SQL' }],
      uncertainties: [],
      preparation: ['准备案例'],
    };
    const advice = db.prepare('SELECT * FROM match_advices').get() as {
      result_json: string;
      content_hash: string;
    };
    expect(JSON.parse(advice.result_json)).toEqual(expected);
    expect(advice.content_hash).toBe(contentHash(expected));
    const run = db.prepare("SELECT * FROM agent_runs WHERE agent_key='job-advice'").get() as {
      output_json: string;
      output_hash: string;
    };
    expect(JSON.parse(run.output_json)).toEqual(expected);
    expect(run.output_hash).toBe(contentHash(expected));
    expect(db.prepare("SELECT output_hash FROM agent_runs WHERE agent_key='other'").get()).toEqual({
      output_hash: 'untouched',
    });
    db.exec(sql);
    expect(db.prepare('SELECT * FROM match_advices').get()).toEqual(advice);
  } finally {
    db.close();
  }
});
