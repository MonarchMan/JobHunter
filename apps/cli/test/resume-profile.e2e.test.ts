import { CandidateProfileService } from '@jobhunter/application';
import { openSqliteDatabase, SqliteCandidateProfileRepository } from '@jobhunter/db';
import {
  parseId,
  SystemIdGenerator,
  utcInstant,
  type CandidateProfileData,
} from '@jobhunter/domain';
import { createTemporaryDataRoot } from '@jobhunter/testkit';
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

const extracted: CandidateProfileData = {
  targetRoles: ['Agent 开发', '大模型应用'],
  preferences: {
    locations: ['深圳'],
    companySizes: ['large', 'medium'],
    employmentTypes: ['全职'],
    excludedTerms: [],
    remoteAccepted: null,
  },
  education: [],
  workExperience: [],
  projects: [],
  skills: [
    {
      name: 'TypeScript',
      level: 'proficient',
      evidence: [{ source: 'resume', quote: 'TypeScript 项目经验' }],
    },
  ],
  domains: ['大模型应用'],
  yearsOfExperience: 3,
  managementExperience: false,
};

function seedFirstProfileVersion(input: {
  readonly dataRoot: string;
  readonly profileId: string;
  readonly resumeDocumentId: string;
}): void {
  const database = openSqliteDatabase({ dataRoot: input.dataRoot });
  try {
    const agentRunId = '018f0000-0000-7000-8000-000000000501';
    database.client
      .prepare(
        `INSERT INTO agent_runs
          (id, agent_key, agent_version, prompt_version, model_config_hash, input_hash,
           cache_key, status, output_json, error_category, error_summary, input_tokens,
           output_tokens, estimated_cost_micros, cost_currency, pricing_version,
           started_at, finished_at)
         VALUES (?, 'resume-profile', '1', '1', ?, ?, ?, 'succeeded', '{}', NULL, NULL,
                 10, 10, 0, 'USD', 'fixture', 1, 2)`,
      )
      .run(agentRunId, 'a'.repeat(64), 'b'.repeat(64), `fixture:${input.profileId}`);
    const profiles = new CandidateProfileService({
      repository: new SqliteCandidateProfileRepository(database.client),
      clock: { now: () => utcInstant(10) },
      ids: new SystemIdGenerator(),
    });
    profiles.applyExtraction({
      profileId: parseId(input.profileId, 'CandidateProfile'),
      expectedCurrentVersionId: null,
      resumeDocumentId: input.resumeDocumentId,
      agentRunId,
      extracted,
    });
  } finally {
    database.close();
  }
}

describe('resume and profile commands', () => {
  it('imports the reference JPEG without exposing content and versions manual profile changes', async () => {
    const root = await createTemporaryDataRoot('jobhunter-cli-profile-');
    const dataRoot = path.join(root.path, '中文 数据');
    const resumePath = path.resolve('docs', 'resumes', 'nowcoder_1787802316450.jpeg');
    try {
      expect((await command(dataRoot, ['init'])).exitCode).toBe(0);
      const imported = await command(dataRoot, ['resume', 'import', resumePath]);
      expect(imported.exitCode).toBe(4);
      expect(imported.stderr).toBe('');
      const serialized = JSON.stringify(imported.body);
      expect(serialized).not.toContain('extractedText');
      expect(serialized).not.toContain(resumePath);
      const result = imported.body as {
        readonly data: {
          readonly document: { readonly id: string; readonly parseStatus: string };
          readonly profileId: string;
          readonly task: { readonly id: string; readonly status: string };
        };
      };
      expect(result.data.document.parseStatus).toBe('needs_ocr');
      expect(result.data.task.status).toBe('pending');

      const duplicate = await command(dataRoot, ['resume', 'import', resumePath]);
      expect(duplicate.body).toMatchObject({ ok: true, data: { deduplicated: true } });

      seedFirstProfileVersion({
        dataRoot,
        profileId: result.data.profileId,
        resumeDocumentId: result.data.document.id,
      });
      expect(
        (await command(dataRoot, ['profile', 'show', result.data.profileId])).body,
      ).toMatchObject({
        ok: true,
        data: { version: { versionNo: 1, effective: { preferences: { locations: ['深圳'] } } } },
      });

      expect(
        (
          await command(dataRoot, [
            'profile',
            'set',
            result.data.profileId,
            '/preferences/locations',
            '["北京","上海"]',
          ])
        ).body,
      ).toMatchObject({ data: { version: { versionNo: 2 } } });
      const locked = await command(dataRoot, [
        'profile',
        'lock',
        result.data.profileId,
        '/preferences/locations',
      ]);
      expect(locked.body).toMatchObject({
        data: { version: { versionNo: 3, lockedPaths: ['/preferences/locations'] } },
      });
      const history = await command(dataRoot, ['profile', 'history', result.data.profileId]);
      const historyVersions = (
        history.body as {
          readonly data: {
            readonly versions: readonly {
              readonly version: {
                readonly versionNo: number;
                readonly lockedPaths: readonly string[];
              };
            }[];
          };
        }
      ).data.versions;
      expect(historyVersions.map((item) => item.version.versionNo)).toEqual([3, 2, 1]);
      expect(historyVersions[0]?.version.lockedPaths).toEqual(['/preferences/locations']);
      const unlocked = await command(dataRoot, [
        'profile',
        'unlock',
        result.data.profileId,
        '/preferences/locations',
      ]);
      expect(unlocked.body).toMatchObject({
        data: { version: { versionNo: 4, lockedPaths: [] } },
      });

      const missing = await command(dataRoot, [
        'profile',
        'show',
        '018f0000-0000-7000-8000-000000009999',
      ]);
      expect(missing.exitCode).toBe(3);
      expect(missing.body).toMatchObject({ ok: false, error: { code: 'PROFILE_NOT_FOUND' } });
    } finally {
      await root.cleanup();
    }
  }, 30_000);
});
