import { PlatformError } from '@jobhunter/recruitment/contracts/platform';
import { canonicalJobFamilies } from '@jobhunter/recruitment/contracts/domain';
import type {
  PlatformProfileSearchPlan,
  PlatformProfileSearchPlanProvider,
} from '@jobhunter/recruitment/contracts/profile-search';
import type { CandidateProfileReader } from '@jobhunter/user/contracts';
/** 从默认第一份资料取得具体意向岗位，不用大类或细分岗位代替原词。 */
export function platformProfileSearchPlan(
  profiles: Pick<CandidateProfileReader, 'listProfiles' | 'getCurrentVersion'>,
): PlatformProfileSearchPlan {
  // 1、资料仓储按创建时间、ID 排序；没有资料或版本时不得退回推荐流。
  const first = profiles.listProfiles()[0];
  const version = first ? profiles.getCurrentVersion(first.id) : null;
  if (!version) throw new PlatformError('session_unavailable', null, 'profile_required');
  // 2、只规范空白和大小写去重，保留用户填写的具体词供官网搜索。
  const keywords: string[] = [];
  const seen = new Set<string>();
  const families = new Set<string>(canonicalJobFamilies);
  for (const role of version.effective.intendedRoles ?? []) {
    const keyword = role.trim().replace(/\s+/gu, ' ');
    if (!keyword) continue;
    if (keyword.length > 200) throw new PlatformError('session_unavailable', null, 'query_invalid');
    // 2.a、新意向字段也须填写具体职位，不改动原有职位类别字段。
    if (families.has(keyword))
      throw new PlatformError('session_unavailable', null, 'query_too_broad');
    const key = keyword.normalize('NFKC').toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    keywords.push(keyword);
    // 2.b、单次动作会逐词建立会话并读取一批，限制词数防止意外放大请求。
    if (keywords.length > 10) throw new PlatformError('session_unavailable', null, 'query_invalid');
  }
  if (keywords.length === 0) throw new PlatformError('session_unavailable', null, 'query_required');
  return { profileVersionId: version.id, keywords };
}

/** 入口注入的资料搜索计划派生器，只有匹配侧读取用户快照。 */
export class ProfilePlatformSearchProvider implements PlatformProfileSearchPlanProvider {
  public constructor(
    private readonly profiles: Pick<CandidateProfileReader, 'listProfiles' | 'getCurrentVersion'>,
  ) {}
  /** 每次重验资料当前版本，防止复用已经失效的搜索条件。 */
  public plan(): PlatformProfileSearchPlan {
    return platformProfileSearchPlan(this.profiles);
  }
}
