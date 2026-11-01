import type { JobHistoryReader } from '@jobhunter/recruitment/contracts/job-history';
import type { CandidateProfileReader } from '@jobhunter/user/contracts';
import type { TaskRelationStatusReader } from '@jobhunter/common/tasks';
import type { WebJobDetail } from '@jobhunter/matching/contracts/web';
import type { WebJobTrace, WebJobTraceRepository } from '../application/web-job-detail-service.js';
import { jobAdviceSchema } from '../job-advice-agent.js';
import { ruleOutcomeSchema, scoreComponentSchema } from '../model.js';
import type Database from 'better-sqlite3';
import { z } from 'zod';

/** 数据库查询结果对应的行结构。 */
interface MatchRow {
  readonly id: string;
  readonly profile_version_id: string;
  readonly filter_status: 'eligible' | 'excluded' | 'uncertain';
  readonly total_score: number;
  readonly components_json: string;
  readonly risks_json: string;
  readonly ruleset_version: string;
  readonly created_at: number;
  readonly advice_json: string | null;
  readonly advice_task_status: string | null;
}

/** 执行数据库结果的解析、转换或持久化辅助逻辑。 */
function advice(row: MatchRow): WebJobDetail['matches'][number]['advice'] {
  if (row.advice_json) {
    return {
      status: 'available',
      content: jobAdviceSchema.parse(JSON.parse(row.advice_json) as unknown),
    };
  }
  if (row.advice_task_status === 'pending' || row.advice_task_status === 'running')
    return { status: 'pending' };
  if (row.advice_task_status === 'failed') return { status: 'failed' };
  return { status: 'not_requested' };
}

/** 查询职位修订、匹配结果与建议的可追溯链路。 */
export class SqliteWebJobTraceRepository implements WebJobTraceRepository {
  readonly #client: Database.Database;

  public constructor(
    client: Database.Database,
    private readonly history: JobHistoryReader,
    private readonly profiles: CandidateProfileReader,
    private readonly taskStatus: TaskRelationStatusReader,
  ) {
    this.#client = client;
  }

  /** 执行数据库组件对外暴露的操作。 */
  public get(jobId: string): WebJobTrace {
    // 1、通过所有者的公开只读端口取得最新职位修订和当前画像身份。
    const revisions = this.history.revisions(jobId);
    const profileIds = this.profiles.listProfiles().flatMap((profile) => {
      const version = this.profiles.getCurrentVersion(profile.id);
      return version ? [version.id] : [];
    });
    // 2、只查询匹配模块拥有的结果、规则和建议表，不读取招聘或用户表。
    const matches = this.#client
      .prepare(
        `WITH candidates AS (
         SELECT mr.*, rs.version AS ruleset_version,
                ROW_NUMBER() OVER (PARTITION BY mr.profile_version_id ORDER BY mr.created_at DESC, mr.id DESC) AS preference
         FROM match_results mr JOIN match_rulesets rs ON rs.id = mr.ruleset_id
         WHERE mr.job_revision_id = ? AND mr.profile_version_id IN (SELECT value FROM json_each(?))
       )
       SELECT c.id, c.profile_version_id, c.filter_status, c.total_score, c.components_json,
              c.risks_json, c.ruleset_version, c.created_at,
              (SELECT ma.result_json FROM match_advices ma WHERE ma.match_result_id = c.id ORDER BY ma.created_at DESC, ma.id DESC LIMIT 1) AS advice_json
       FROM candidates c WHERE c.preference = 1 ORDER BY c.total_score DESC, c.created_at DESC`,
      )
      .all(revisions[0]?.id ?? null, JSON.stringify(profileIds)) as Omit<
      MatchRow,
      'advice_task_status'
    >[];
    // 3、任务状态由通用任务端口读取；按原语义组合安全展示结果。
    return {
      revisions: [...revisions],
      matches: matches.map((row) => ({
        id: row.id,
        profileVersionId: row.profile_version_id,
        filterStatus: row.filter_status,
        totalScore: row.total_score,
        components: z.array(scoreComponentSchema).parse(JSON.parse(row.components_json) as unknown),
        ruleOutcomes: z.array(ruleOutcomeSchema).parse(JSON.parse(row.risks_json) as unknown),
        rulesetVersion: row.ruleset_version,
        createdAt: new Date(row.created_at).toISOString(),
        advice: advice({
          ...row,
          advice_task_status: this.taskStatus.latest('match.advise', 'matchResultId', row.id),
        }),
      })),
    };
  }
}
