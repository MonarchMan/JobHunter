import {
  contentHash,
  parseId,
  type Clock,
  type IdGenerator,
  type JobRevisionId,
  type JobEnrichmentId,
  type ProfileVersionId,
} from '@jobhunter/common/domain';
import type { CandidateProfileReader } from '@jobhunter/user/contracts';
import { buildMatchIdentity } from '../domain/index.js';
import { composeMatchScore, scoreWeights } from '../score-composition.js';
import { calculateDeterministicMatch } from '../scoring.js';
import { currentMatchRuleset, defaultMatchRulesetId } from '../rulesets.js';
import type {
  MatchingRepository,
  MatchResultRecord,
  MatchRulesetRecord,
} from '../ports/matching.js';

/** 匹配输入不满足约束。 */
export class MatchingInputError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'MatchingInputError';
  }
}

/** 使用当前唯一规则计算评分；历史记录只作为结果快照读取。 */
export class DeterministicMatchingService {
  readonly #matching: MatchingRepository;
  readonly #profiles: CandidateProfileReader;
  readonly #clock: Clock;
  readonly #ids: IdGenerator;
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

  /** 读取代码中的当前规则配置，不进行数据库注册。 */
  public ensureRuleset(): MatchRulesetRecord {
    return {
      id: defaultMatchRulesetId,
      definition: currentMatchRuleset,
      definitionHash: contentHash(currentMatchRuleset),
      active: true,
      createdAt: this.#clock.now(),
    };
  }

  /** 校验冻结输入、执行当前规则、合成模型评分并保存结果快照。 */
  public compute(input: {
    readonly profileVersionId: ProfileVersionId;
    readonly jobRevisionId: JobRevisionId;
    readonly jobEnrichmentId: JobEnrichmentId | null;
    readonly modelScore?: number | null;
    readonly modelReasons?: readonly string[];
  }): { readonly match: MatchResultRecord; readonly created: boolean } {
    // 1、验证职位、画像和增强结果属于同一次输入。
    const profile = this.#profiles.getVersion(input.profileVersionId);
    if (!profile || profile.isCandidate)
      throw new MatchingInputError('Profile version does not exist.');
    const revision = this.#matching.getRevision(input.jobRevisionId);
    if (!revision) throw new MatchingInputError('Job revision does not exist.');
    const enrichment = input.jobEnrichmentId
      ? this.#matching.getEnrichment(input.jobEnrichmentId)
      : null;
    if (input.jobEnrichmentId && !enrichment)
      throw new MatchingInputError('Job enrichment does not exist.');
    if (enrichment && enrichment.jobRevisionId !== revision.id)
      throw new MatchingInputError('Job enrichment belongs to a different revision.');
    const ruleset = this.ensureRuleset();
    const rules = calculateDeterministicMatch({
      profile: profile.effective,
      job: revision.normalized,
      company: this.#matching.getCompanyContext(revision.normalized.companyId),
      understanding: enrichment?.result ?? null,
    });
    // 2、模型缺失时退回规则分；有模型时保持当前 30/70 合成口径。
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
      rulesetHash: ruleset.definitionHash,
      modelUsed: modelScore !== null,
    });
    // 3、以内容身份幂等保存；不会回写历史结果分数。
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
      components,
      ruleOutcomes: rules.ruleOutcomes,
      inputHash: contentHash({
        identity: identity.inputHash,
        rules,
        modelScore,
        modelReasons: input.modelReasons ?? [],
        enrichmentHash: enrichment?.contentHash ?? null,
      }),
      createdAt: this.#clock.now(),
    });
    return { match, created: match.id === candidateId };
  }
}
