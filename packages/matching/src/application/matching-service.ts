import {
  contentHash,
  parseId,
  type Clock,
  type IdGenerator,
  type JobEnrichmentId,
  type JobRevisionId,
  type MatchRulesetId,
  type ProfileVersionId,
} from '@jobhunter/common/domain';
import { buildMatchIdentity } from '../domain/index.js';
import { composeMatchScore, scoreWeights } from '../score-composition.js';
import { calculateDeterministicMatch } from '../scoring.js';
import {
  matchRulesetV1,
  matchRulesetV2,
  matchRulesetV3,
  matchRulesetV31,
  matchRulesetV32,
} from '../rulesets.js';
import type { MatchingRepository, MatchResultRecord } from '../ports/matching.js';
import type { CandidateProfileReader } from '@jobhunter/user/contracts';

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
  readonly #profiles: CandidateProfileReader;
  readonly #clock: Clock;
  readonly #ids: IdGenerator;

  /** 执行应用组件对外暴露的操作。 */
  public constructor(input: {
    readonly matching: MatchingRepository;
    readonly profiles: CandidateProfileReader;
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

  /** 新计算启用招聘分类规则，独立版本不会覆盖 v1 历史记录。 */
  public ensureRulesetV2(input: {
    readonly id: MatchRulesetId;
    readonly activate?: boolean;
  }): ReturnType<MatchingRepository['upsertRuleset']> {
    return this.#matching.upsertRuleset({
      id: input.id,
      version: matchRulesetV2.version,
      definition: matchRulesetV2,
      definitionHash: contentHash(matchRulesetV2),
      active: input.activate ?? true,
      createdAt: this.#clock.now(),
    });
  }

  /** 幂等登记并按调用方选择激活 v3，保留历史规则及其评分记录。 */
  public ensureRulesetV3(input: {
    readonly id: MatchRulesetId;
    readonly activate?: boolean;
  }): ReturnType<MatchingRepository['upsertRuleset']> {
    return this.#matching.upsertRuleset({
      id: input.id,
      version: matchRulesetV3.version,
      definition: matchRulesetV3,
      definitionHash: contentHash(matchRulesetV3),
      active: input.activate ?? true,
      createdAt: this.#clock.now(),
    });
  }

  /** 幂等登记并按调用方选择激活 v3.1，保留历史规则及其评分记录。 */
  public ensureRulesetV31(input: {
    readonly id: MatchRulesetId;
    readonly activate?: boolean;
  }): ReturnType<MatchingRepository['upsertRuleset']> {
    return this.#matching.upsertRuleset({
      id: input.id,
      version: matchRulesetV31.version,
      definition: matchRulesetV31,
      definitionHash: contentHash(matchRulesetV31),
      active: input.activate ?? true,
      createdAt: this.#clock.now(),
    });
  }

  /** 幂等登记毕业资格修复版本，保留旧记录且不触发全量重算。 */
  public ensureRulesetV32(input: {
    readonly id: MatchRulesetId;
    readonly activate?: boolean;
  }): ReturnType<MatchingRepository['upsertRuleset']> {
    return this.#matching.upsertRuleset({
      id: input.id,
      version: matchRulesetV32.version,
      definition: matchRulesetV32,
      definitionHash: contentHash(matchRulesetV32),
      active: input.activate ?? true,
      createdAt: this.#clock.now(),
    });
  }

  /** 计算简历版本与职位之间的匹配结果。 */
  public compute(input: {
    // 1、读取并校验规则集；2、规范化简历/职位输入；3、计算分项得分；4、合成总分并持久化结果。
    readonly profileVersionId: ProfileVersionId;
    readonly jobRevisionId: JobRevisionId;
    readonly jobEnrichmentId: JobEnrichmentId | null;
    /** 模型阶段拟合分与理由；null 表示模型不可用或降级，总分退回规则口径。 */
    readonly modelScore?: number | null;
    readonly modelReasons?: readonly string[];
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
    const rules = calculateDeterministicMatch(
      {
        profile: profile.effective,
        job: revision.normalized,
        company: this.#matching.getCompanyContext(revision.normalized.companyId),
        understanding: enrichment?.result ?? null,
      },
      ruleset.definition,
    );
    // 5、规则分与模型分按固定权重合成；模型分缺失时不猜测，退回规则口径。
    const modelScore = input.modelScore ?? null;
    const composition = composeMatchScore(rules.totalScore, modelScore);
    const components =
      modelScore === null
        ? rules.components
        : [
            ...rules.components,
            {
              dimension: 'model' as const,
              score: Math.round(modelScore * scoreWeights.model * 100) / 100,
              maximumScore: Math.round(scoreWeights.model * 100),
              matchedEvidence: (input.modelReasons ?? []).map((reason) => ({
                source: 'enrichment' as const,
                path: '/fitScore',
                summary: reason,
              })),
              missingEvidence: [],
              uncertainties: [],
              modelScore,
            },
          ];
    const identity = buildMatchIdentity({
      profileVersionId: profile.id,
      jobRevisionId: revision.id,
      jobEnrichmentId: enrichment?.id ?? null,
      usesEnrichment: enrichment !== null,
      rulesetId: ruleset.id,
      rulesetVersion: ruleset.version,
      scoringVersion: composition.scoringVersion,
    });
    const candidateId = parseId(this.#ids.generate(), 'MatchResult');
    const match = this.#matching.createOrGetMatch({
      id: candidateId,
      profileVersionId: profile.id,
      jobRevisionId: revision.id,
      jobEnrichmentId: enrichment?.id ?? null,
      rulesetId: ruleset.id,
      filterStatus: rules.filterStatus,
      totalScore: composition.totalScore,
      modelScore,
      scoringVersion: composition.scoringVersion,
      components,
      ruleOutcomes: rules.ruleOutcomes,
      inputHash: identity.inputHash,
      createdAt: this.#clock.now(),
    });
    return { match, created: match.id === candidateId };
  }
}
