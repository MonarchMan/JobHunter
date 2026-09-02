import type {
  DashboardReadModel,
  WebDashboard,
  WebDashboardNextAction,
  WebDashboardHighlightJob,
} from '@jobhunter/application';
import { scoreComponentSchema } from '@jobhunter/matching';
import type Database from 'better-sqlite3';
import { z } from 'zod';

interface CountRow {
  readonly count: number;
}

interface LatestSyncRow {
  readonly source_name: string;
  readonly status: string;
  readonly finished_at: number;
}

interface HighlightJobRow {
  readonly id: string;
  readonly company_name: string;
  readonly title: string;
  readonly locations: string;
  readonly score: number | null;
  readonly published_at: number | null;
  readonly updated_at: number;
  readonly first_seen_at: number;
}

interface ProfileExistsRow {
  readonly has_profile: 0 | 1;
}

interface MatchComponentsRow {
  readonly components_json: string;
}

function count(client: Database.Database, sql: string, ...parameters: readonly unknown[]): number {
  return (client.prepare(sql).get(...parameters) as CountRow).count;
}

export class SqliteDashboardReadModel implements DashboardReadModel {
  readonly #client: Database.Database;

  public constructor(client: Database.Database) {
    this.#client = client;
  }

  public snapshot(): WebDashboard {
    const latestSync = this.#client
      .prepare(
        `SELECT c.name AS source_name, sr.status, sr.finished_at
         FROM sync_runs sr
         JOIN job_sources js ON js.id = sr.source_id
         JOIN companies c ON c.id = js.company_id
         WHERE sr.finished_at IS NOT NULL
         ORDER BY sr.finished_at DESC, sr.id DESC
         LIMIT 1`,
      )
      .get() as LatestSyncRow | undefined;

    const activeJobs = count(
      this.#client,
      `SELECT count(*) AS count FROM jobs WHERE status = 'active'`,
    );
    const currentMatches = count(
      this.#client,
      `WITH latest_revisions AS (
         SELECT id, row_number() OVER (PARTITION BY job_id ORDER BY revision_no DESC) AS position
         FROM job_revisions
       )
       SELECT count(*) AS count
       FROM match_results mr
       JOIN profile_versions pv ON pv.id = mr.profile_version_id AND pv.is_current = 1
       JOIN latest_revisions lr ON lr.id = mr.job_revision_id AND lr.position = 1
       WHERE mr.filter_status <> 'excluded'`,
    );
    const enabledSources = count(
      this.#client,
      `SELECT count(*) AS count FROM job_sources WHERE enabled = 1`,
    );
    const failedTasks = count(
      this.#client,
      `SELECT count(*) AS count FROM tasks WHERE status = 'failed'`,
    );

    const hasProfile =
      (
        this.#client
          .prepare(
            `SELECT CASE WHEN EXISTS(SELECT 1 FROM candidate_profiles LIMIT 1) THEN 1 ELSE 0 END AS has_profile`,
          )
          .get() as ProfileExistsRow
      ).has_profile === 1;

    const nextAction = this.#computeNextAction(
      hasProfile,
      enabledSources,
      currentMatches,
      failedTasks,
    );

    const highlightJobs = this.#getHighlightJobs();

    return {
      activeJobs,
      currentMatches,
      sources: {
        healthy: count(
          this.#client,
          `SELECT count(*) AS count FROM job_sources WHERE enabled = 1 AND health_status = 'healthy'`,
        ),
        total: enabledSources,
      },
      tasks: {
        pending: count(
          this.#client,
          `SELECT count(*) AS count FROM tasks WHERE status = 'pending'`,
        ),
        failed: failedTasks,
      },
      latestSync: latestSync
        ? {
            sourceName: latestSync.source_name,
            status: latestSync.status,
            finishedAt: new Date(latestSync.finished_at).toISOString(),
          }
        : null,
      nextAction,
      highlightJobs,
    };
  }

  #computeNextAction(
    hasProfile: boolean,
    enabledSources: number,
    currentMatches: number,
    failedTasks: number,
  ): WebDashboardNextAction | null {
    if (!hasProfile) {
      return {
        type: 'create_profile',
        message: '建立简历画像是第一步',
        href: '/profile',
      };
    }

    if (enabledSources === 0) {
      return {
        type: 'enable_sources',
        message: '启用至少一个招聘来源',
        href: '/sources',
      };
    }

    if (failedTasks > 0) {
      return {
        type: 'handle_failures',
        message: `${String(failedTasks)} 个任务需要处理`,
        count: failedTasks,
        href: '/tasks?status=failed',
      };
    }

    // Get recent high-score jobs (7 days, score >= 80)
    const recentHighScoreCount = count(
      this.#client,
      `WITH latest_revisions AS (
         SELECT id, job_id, row_number() OVER (PARTITION BY job_id ORDER BY revision_no DESC) AS position
         FROM job_revisions
       )
       SELECT count(*) AS count
       FROM match_results mr
       JOIN profile_versions pv ON pv.id = mr.profile_version_id AND pv.is_current = 1
       JOIN latest_revisions lr ON lr.id = mr.job_revision_id AND lr.position = 1
       JOIN jobs j ON j.id = lr.job_id
       WHERE mr.filter_status <> 'excluded'
         AND j.status = 'active'
         AND mr.total_score >= 80
         AND j.first_seen_at >= ?`,
      Date.now() - 7 * 24 * 60 * 60 * 1000,
    );

    if (recentHighScoreCount > 0) {
      const topJob = this.#client
        .prepare(
          `WITH latest_revisions AS (
             SELECT id, job_id, row_number() OVER (PARTITION BY job_id ORDER BY revision_no DESC) AS position
             FROM job_revisions
           )
           SELECT j.id, c.name AS company_name, j.title, mr.total_score AS score
           FROM match_results mr
           JOIN profile_versions pv ON pv.id = mr.profile_version_id AND pv.is_current = 1
           JOIN latest_revisions lr ON lr.id = mr.job_revision_id AND lr.position = 1
           JOIN jobs j ON j.id = lr.job_id
           JOIN companies c ON c.id = j.company_id
           WHERE mr.filter_status <> 'excluded'
             AND j.status = 'active'
             AND mr.total_score >= 80
             AND j.first_seen_at >= ?
           ORDER BY mr.total_score DESC, j.first_seen_at DESC
           LIMIT 1`,
        )
        .get(Date.now() - 7 * 24 * 60 * 60 * 1000) as
        { id: string; company_name: string; title: string; score: number } | undefined;

      return {
        type: 'review_matches',
        message: `${String(recentHighScoreCount)} 个新匹配职位待查看`,
        count: recentHighScoreCount,
        topJob: topJob
          ? {
              id: topJob.id,
              companyName: topJob.company_name,
              title: topJob.title,
              score: topJob.score,
            }
          : null,
        href: '/jobs?sort=score_desc',
      };
    }

    if (currentMatches > 0) {
      return {
        type: 'all_good',
        message: '工作台运行正常，继续关注新职位',
      };
    }

    return null;
  }

  #getHighlightJobs(): WebDashboardHighlightJob[] {
    const rows = this.#client
      .prepare(
        `WITH latest_revisions AS (
           SELECT id, job_id, row_number() OVER (PARTITION BY job_id ORDER BY revision_no DESC) AS position
           FROM job_revisions
         )
         SELECT
           j.id,
           c.name AS company_name,
           j.title,
           j.locations_json AS locations,
           mr.total_score AS score,
           j.published_at,
           j.updated_at,
           j.first_seen_at
         FROM jobs j
         JOIN companies c ON c.id = j.company_id
         JOIN latest_revisions lr ON lr.job_id = j.id AND lr.position = 1
         JOIN job_revisions jr ON jr.id = lr.id
         LEFT JOIN profile_versions pv ON pv.is_current = 1
         LEFT JOIN match_results mr ON mr.job_revision_id = lr.id AND mr.profile_version_id = pv.id
         WHERE j.status = 'active'
           AND (mr.filter_status IS NULL OR mr.filter_status <> 'excluded')
           AND (j.first_seen_at >= ? OR j.updated_at >= ?)
         ORDER BY
           CASE WHEN mr.total_score IS NOT NULL THEN mr.total_score ELSE 0 END DESC,
           j.first_seen_at DESC,
           j.updated_at DESC
         LIMIT 5`,
      )
      .all(
        Date.now() - 7 * 24 * 60 * 60 * 1000,
        Date.now() - 7 * 24 * 60 * 60 * 1000,
      ) as HighlightJobRow[];

    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    return rows.map((row) => ({
      id: row.id,
      companyName: row.company_name,
      title: row.title,
      locations: JSON.parse(row.locations) as string[],
      score: row.score,
      matchReasons: this.#getMatchReasons(row.id),
      publishedAt: row.published_at ? new Date(row.published_at).toISOString() : null,
      updatedAt: new Date(row.updated_at).toISOString(),
      isNew: row.first_seen_at >= sevenDaysAgo,
    }));
  }

  #getMatchReasons(jobId: string): string[] {
    const row = this.#client
      .prepare(
        `WITH latest_revisions AS (
           SELECT id, row_number() OVER (PARTITION BY job_id ORDER BY revision_no DESC) AS position
           FROM job_revisions
           WHERE job_id = ?
         )
         SELECT mr.components_json
         FROM match_results mr
         JOIN profile_versions pv ON pv.id = mr.profile_version_id AND pv.is_current = 1
         JOIN latest_revisions lr ON lr.id = mr.job_revision_id AND lr.position = 1
         WHERE mr.filter_status <> 'excluded'
         ORDER BY mr.total_score DESC, mr.created_at DESC, mr.id DESC
         LIMIT 1`,
      )
      .get(jobId) as MatchComponentsRow | undefined;

    if (!row) return [];
    const parsed = z.array(scoreComponentSchema).safeParse(JSON.parse(row.components_json));
    if (!parsed.success) return [];

    const categoryLabels: Record<string, string> = {
      experience: '经验匹配',
      skills: '技能匹配',
      location: '地点偏好',
      industry: '行业匹配',
      role: '岗位匹配',
    };

    return parsed.data
      .filter((component) => component.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 3)
      .map((component) => categoryLabels[component.dimension] ?? component.dimension);
  }
}
