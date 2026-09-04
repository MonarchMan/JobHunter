import {
  buildMatchIdentity,
  contentHash,
  parseId,
  type Clock,
  type IdGenerator,
  type JobEnrichmentId,
  type JobRevisionId,
  type MatchRulesetId,
  type ProfileVersionId,
} from '@jobhunter/domain';
import { calculateDeterministicMatch, matchRulesetV1 } from '@jobhunter/matching';
import type { MatchingRepository, MatchResultRecord } from '../ports/matching.js';
import type { CandidateProfileRepository } from '../ports/profiles.js';

/** 匹配输入或规则集不满足约束。 */
export class MatchingInputError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'MatchingInputError';
  }
}

/** 使用冻结规则集执行可复现的确定性职位匹配。 */
export class DeterministicMatchingService {
  readonly #matching: MatchingRepository;
  readonly #profiles: CandidateProfileRepository;
  readonly #clock: Clock;
  readonly #ids: IdGenerator;

  /** 执行应用组件对外暴露的操作。 */
  public constructor(input: {
    readonly matching: MatchingRepository;
    readonly profiles: CandidateProfileRepository;
    readonly clock: Clock;
    readonly ids: IdGenerator;
  }) {
    this.#matching = input.matching;
    this.#profiles = input.profiles;
    this.#clock = input.clock;
    this.#ids = input.ids;
  }

  /** 确保默认规则集存在且定义哈希一致。 */
  public ensureRulesetV1(input: {
    readonly id: MatchRulesetId;
    readonly activate?: boolean;
  }): ReturnType<MatchingRepository['upsertRuleset']> {
    return this.#matching.upsertRuleset({
      id: input.id,
      version: matchRulesetV1.version,
      definition: matchRulesetV1,
      definitionHash: contentHash(matchRulesetV1),
      active: input.activate ?? true,
      createdAt: this.#clock.now(),
    });
  }

  /** 计算简历版本与职位之间的匹配结果。 */
  public compute(input: {
    // 1、读取并校验规则集；2、规范化简历/职位输入；3、计算分项得分；4、汇总并持久化结果。
    readonly profileVersionId: ProfileVersionId;
    readonly jobRevisionId: JobRevisionId;
    readonly jobEnrichmentId: JobEnrichmentId | null;
    readonly rulesetId?: MatchRulesetId;
  }): { readonly match: MatchResultRecord; readonly created: boolean } {
    const profile = this.#profiles.getVersion(input.profileVersionId);
    if (!profile) throw new MatchingInputError('Profile version does not exist.');
    const revision = this.#matching.getRevision(input.jobRevisionId);
    if (!revision) throw new MatchingInputError('Job revision does not exist.');
    const enrichment = input.jobEnrichmentId
      ? this.#matching.getEnrichment(input.jobEnrichmentId)
      : null;
    if (input.jobEnrichmentId && !enrichment) {
      throw new MatchingInputError('Job enrichment does not exist.');
    }
    if (enrichment && enrichment.jobRevisionId !== revision.id) {
      throw new MatchingInputError('Job enrichment belongs to a different revision.');
    }
    const ruleset = input.rulesetId
      ? this.#matching.getRuleset(input.rulesetId)
      : this.#matching.getActiveRuleset();
    if (!ruleset) throw new MatchingInputError('No match ruleset is available.');
    const output = calculateDeterministicMatch(
      {
        profile: profile.effective,
        job: revision.normalized,
        company: this.#matching.getCompanyContext(revision.normalized.companyId),
        understanding: enrichment?.result ?? null,
      },
      ruleset.definition,
    );
    const identity = buildMatchIdentity({
      profileVersionId: profile.id,
      jobRevisionId: revision.id,
      jobEnrichmentId: enrichment?.id ?? null,
      usesEnrichment: enrichment !== null,
      rulesetId: ruleset.id,
      rulesetVersion: ruleset.version,
    });
    const candidateId = parseId(this.#ids.generate(), 'MatchResult');
    const match = this.#matching.createOrGetMatch({
      id: candidateId,
      profileVersionId: profile.id,
      jobRevisionId: revision.id,
      jobEnrichmentId: enrichment?.id ?? null,
      rulesetId: ruleset.id,
      filterStatus: output.filterStatus,
      totalScore: output.totalScore,
      components: output.components,
      ruleOutcomes: output.ruleOutcomes,
      inputHash: identity.inputHash,
      createdAt: this.#clock.now(),
    });
    return { match, created: match.id === candidateId };
  }
}
