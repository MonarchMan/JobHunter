import type { AgentRunReader } from '@jobhunter/agent-core';
import type { CandidateProfileId } from '@jobhunter/domain';
import type { CandidateProfileRepository, ProfileVersionRecord } from '../ports/profiles.js';

export interface ProfileVersionInspection {
  readonly version: ProfileVersionRecord;
  readonly extractionAgent: {
    readonly key: string;
    readonly version: string;
    readonly promptVersion: string;
    readonly modelConfigHash: string;
  } | null;
}

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

  public current(profileId: CandidateProfileId): ProfileVersionInspection | null {
    const version = this.#profiles.getCurrentVersion(profileId);
    return version ? this.#inspect(version) : null;
  }

  public history(profileId: CandidateProfileId): readonly ProfileVersionInspection[] {
    return this.#profiles.listVersions(profileId).map((version) => this.#inspect(version));
  }

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
