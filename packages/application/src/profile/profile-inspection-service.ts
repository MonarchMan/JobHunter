import type { AgentRunReader } from '@jobhunter/agent-core';
import type { CandidateProfileId } from '@jobhunter/domain';
import type { CandidateProfileRepository, ProfileVersionRecord } from '../ports/profiles.js';

/** 应用层数据结构或端口契约。 */
export interface ProfileVersionInspection {
  readonly version: ProfileVersionRecord;
  readonly extractionAgent: {
    readonly key: string;
    readonly version: string;
    readonly promptVersion: string;
    readonly modelConfigHash: string;
  } | null;
}

/** 将画像版本与 Agent 运行记录组合为可审计查询结果。 */
export class ProfileInspectionService {
  readonly #profiles: CandidateProfileRepository;
  readonly #agentRuns: AgentRunReader;

  public constructor(input: {
    readonly profiles: CandidateProfileRepository;
    readonly agentRuns: AgentRunReader;
  }) {
    this.#profiles = input.profiles;
    this.#agentRuns = input.agentRuns;
  }

  /** 查询当前画像版本及其提取 Agent 信息。 */
  public current(profileId: CandidateProfileId): ProfileVersionInspection | null {
    const version = this.#profiles.getCurrentVersion(profileId);
    return version ? this.#inspect(version) : null;
  }

  /** 查询画像版本历史并补充每个版本的 Agent 元数据。 */
  public history(profileId: CandidateProfileId): readonly ProfileVersionInspection[] {
    return this.#profiles.listVersions(profileId).map((version) => this.#inspect(version));
  }

  /** 将单个画像版本映射为脱敏检查视图。 */
  #inspect(version: ProfileVersionRecord): ProfileVersionInspection {
    const run = version.agentRunId ? this.#agentRuns.get(version.agentRunId) : null;
    return {
      version,
      extractionAgent: run
        ? {
            key: run.agentKey,
            version: run.agentVersion,
            promptVersion: run.promptVersion,
            modelConfigHash: run.modelConfigHash,
          }
        : null,
    };
  }
}
