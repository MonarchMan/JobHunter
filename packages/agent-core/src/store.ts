import type { AgentErrorCategory } from './errors.js';

/** 模块使用的类型约束。 */
export type AgentRunStatus = 'running' | 'succeeded' | 'failed' | 'cancelled';

/** 模块数据结构或契约。 */
export interface AgentRunRecord {
  readonly id: string;
  readonly agentKey: string;
  readonly agentVersion: string;
  readonly promptVersion: string;
  readonly modelConfigHash: string;
  readonly inputHash: string;
  readonly cacheKey: string;
  readonly status: AgentRunStatus;
  readonly output: unknown;
  readonly errorCategory: AgentErrorCategory | null;
  readonly errorSummary: string | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly estimatedCostMicros: number | null;
  readonly costCurrency: string | null;
  readonly pricingVersion: string | null;
  readonly startedAt: number;
  readonly finishedAt: number | null;
}

/** 模块数据结构或契约。 */
export interface AgentRunUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimatedCostMicros: number;
  readonly costCurrency: string;
  readonly pricingVersion: string;
}

/** 模块数据结构或契约。 */
export interface ToolCallRecord {
  readonly id: string;
  readonly agentRunId: string;
  readonly sequenceNo: number;
  readonly toolKey: string;
  readonly inputSummary: unknown;
  readonly outputSummary: unknown;
  readonly status: AgentRunStatus;
  readonly durationMs: number | null;
  readonly errorSummary: string | null;
}

/** 模块数据结构或契约。 */
export interface AgentRunStore {
  get(id: string): AgentRunRecord | null;
  findSucceeded(cacheKey: string): AgentRunRecord | null;
  createRunning(record: AgentRunRecord): void;
  completeSucceeded(input: {
    readonly id: string;
    readonly cacheKey: string;
    readonly output: unknown;
    readonly usage: AgentRunUsage;
    readonly finishedAt: number;
  }): { readonly kind: 'stored' | 'race'; readonly record: AgentRunRecord };
  completeFailed(input: {
    readonly id: string;
    readonly status: 'failed' | 'cancelled';
    readonly category: AgentErrorCategory;
    readonly summary: string;
    readonly usage: AgentRunUsage;
    readonly finishedAt: number;
  }): AgentRunRecord;
  saveToolCall(record: ToolCallRecord): void;
}

/** 模块使用的类型约束。 */
export type AgentRunReader = Pick<AgentRunStore, 'get'>;
