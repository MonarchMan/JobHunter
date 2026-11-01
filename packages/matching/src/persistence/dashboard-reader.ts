import type Database from 'better-sqlite3';
import { z } from 'zod';
import type { ProfileIdentityReader } from '@jobhunter/user/contracts';
import type { DashboardJobSnapshot } from '@jobhunter/recruitment/contracts/dashboard';
import type { MatchingDashboardSnapshot } from '../contracts/dashboard.js';
import { scoreComponentSchema } from '../model.js';

/** 仅查询匹配结果表，通过公开快照关联招聘事实与当前画像。 */
export class SqliteMatchingDashboardReader {
  public constructor(
    private readonly client: Database.Database,
    private readonly profiles: ProfileIdentityReader,
    private readonly now: () => number = Date.now,
  ) {}

  public snapshot(jobs: readonly DashboardJobSnapshot[]): MatchingDashboardSnapshot {
    // 1、读取当前画像身份和匹配记录，以输入修订身份判断结果是否仍然有效。
    const profileIds = this.profiles.currentVersionIds();
    const rows = z
      .array(
        z.object({
          id: z.string(),
          revisionId: z.string(),
          profileId: z.string(),
          filterStatus: z.string(),
          score: z.number(),
          components: z.string(),
          createdAt: z.number(),
        }),
      )
      .parse(
        this.client
          .prepare(
            'SELECT id, job_revision_id AS revisionId, profile_version_id AS profileId, filter_status AS filterStatus, total_score AS score, components_json AS components, created_at AS createdAt FROM match_results WHERE profile_version_id IN (SELECT value FROM json_each(?))',
          )
          .all(JSON.stringify(profileIds)),
      );
    const cutoff = this.now() - 7 * 24 * 60 * 60 * 1000;
    const current = jobs.flatMap((job) =>
      rows
        .filter((row) => row.revisionId === job.latestRevisionId && row.filterStatus !== 'excluded')
        .map((match) => ({ job, match })),
    );
    const recent = current
      .filter(
        ({ job, match }) =>
          job.status === 'active' && job.firstSeenAt >= cutoff && match.score >= 80,
      )
      .sort((a, b) => b.match.score - a.match.score || b.job.firstSeenAt - a.job.firstSeenAt);
    // 2、保留原首页的画像与结果关联语义；无当前画像或无匹配记录也可展示新职位。
    const candidates = jobs
      .filter(
        (job) =>
          job.status === 'active' &&
          job.latestRevisionId !== null &&
          (job.firstSeenAt >= cutoff || job.updatedAt >= cutoff),
      )
      .flatMap((job) =>
        (profileIds.length ? profileIds : [null]).flatMap((profileId) => {
          const matches = rows.filter(
            (row) => row.revisionId === job.latestRevisionId && row.profileId === profileId,
          );
          return (matches.length ? matches : [null])
            .filter((match) => match?.filterStatus !== 'excluded')
            .map((match) => ({ job, match }));
        }),
      )
      .sort(
        (a, b) =>
          (b.match?.score ?? 0) - (a.match?.score ?? 0) ||
          b.job.firstSeenAt - a.job.firstSeenAt ||
          b.job.updatedAt - a.job.updatedAt,
      )
      .slice(0, 5);
    const labels: Record<string, string> = {
      experience: '经验匹配',
      skills: '技能匹配',
      location: '地点偏好',
      industry: '行业匹配',
      role: '岗位匹配',
    };
    // 3、将已校验评分转换为有限展示原因；损坏的历史原因继续按空列表展示。
    const highlightJobs = candidates.map(({ job, match }) => {
      const best = current
        .filter((item) => item.job.id === job.id)
        .sort(
          (a, b) =>
            b.match.score - a.match.score ||
            b.match.createdAt - a.match.createdAt ||
            b.match.id.localeCompare(a.match.id),
        )[0]?.match;
      const parsed = best
        ? z.array(scoreComponentSchema).safeParse(JSON.parse(best.components) as unknown)
        : null;
      return {
        id: job.id,
        companyName: job.companyName,
        title: job.title,
        locations: [...job.locations],
        score: match?.score ?? null,
        matchReasons: parsed?.success
          ? parsed.data
              .filter((component) => component.score > 0)
              .sort((a, b) => b.score - a.score)
              .slice(0, 3)
              .map((component) => labels[component.dimension] ?? component.dimension)
          : [],
        publishedAt: job.publishedAt ? new Date(job.publishedAt).toISOString() : null,
        updatedAt: new Date(job.updatedAt).toISOString(),
        isNew: job.firstSeenAt >= cutoff,
      };
    });
    const top = recent[0];
    return {
      currentMatches: current.length,
      recentHighScoreCount: recent.length,
      topJob: top
        ? {
            id: top.job.id,
            companyName: top.job.companyName,
            title: top.job.title,
            score: top.match.score,
          }
        : null,
      highlightJobs,
    };
  }
}
