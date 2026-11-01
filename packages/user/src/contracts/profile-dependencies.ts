/** 用户资料生命周期的派生数据参与者；实现者只清理自己拥有的数据。 */
export interface ProfileDerivedDataManager {
  matchResultIds(profileVersionIds: readonly string[]): readonly string[];
  adviceAgentRunIds(matchResultIds: readonly string[]): readonly string[];
  deleteMatchesForVersions(profileVersionIds: readonly string[]): void;
  deleteMatchResults(matchResultIds: readonly string[]): void;
  hasAgentRunReferences(agentRunId: string): boolean;
}

/** 参与者必须同步使用入口提供的同一事务连接，禁止在清理过程中调用外部服务。 */
export interface AgentRunCleanupParticipant {
  prune(agentRunId: string, referenced: boolean): void;
}
