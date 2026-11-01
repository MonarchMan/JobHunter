import type Database from 'better-sqlite3';
import { z } from 'zod';
import type { ProfileIdentityReader, MatchingProfileIdentityReader } from '../contracts/index.js';
import { parseId, type CandidateProfileId, type ProfileVersionId } from '@jobhunter/common/domain';

/** 用户侧最小只读身份投影，避免运营统计解析整个画像文档。 */
export class SqliteProfileIdentityReader
  implements ProfileIdentityReader, MatchingProfileIdentityReader
{
  public constructor(private readonly client: Database.Database) {}

  public hasProfiles(): boolean {
    return Boolean(
      this.client
        .prepare('SELECT EXISTS(SELECT 1 FROM candidate_profiles) AS present')
        .pluck()
        .get(),
    );
  }

  public currentVersionIds(): readonly string[] {
    return z
      .array(z.string().min(1))
      .parse(
        this.client.prepare('SELECT id FROM profile_versions WHERE is_current=1').pluck().all(),
      );
  }

  /** 按资料身份定位唯一当前版本。 */
  public currentVersionId(profileId: CandidateProfileId): ProfileVersionId | null {
    const value = this.client
      .prepare('SELECT id FROM profile_versions WHERE profile_id=? AND is_current=1')
      .pluck()
      .get(profileId);
    return value === undefined ? null : parseId(z.string().parse(value), 'ProfileVersion');
  }

  /** 以稳定身份游标分页，保持匹配批次原有的数量限制。 */
  public currentVersionIdsPage(input: {
    readonly afterId: string | null;
    readonly limit: number;
  }): readonly ProfileVersionId[] {
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 500)
      throw new TypeError('Profile version page limit is invalid.');
    return this.client
      .prepare(
        'SELECT id FROM profile_versions WHERE is_current=1 AND (? IS NULL OR id>?) ORDER BY id ASC LIMIT ?',
      )
      .pluck()
      .all(input.afterId, input.afterId, input.limit)
      .map((id) => parseId(z.string().parse(id), 'ProfileVersion'));
  }
}
