import type { ModelBilling, ModelRequestRecord } from '../contracts/model-usage.js';
import type { AgentErrorCategory } from './errors.js';

/** 模块使用的类型约束。 */
export type AgentRunStatus = 'running' | 'succeeded' | 'failed' | 'cancelled';

/** 模块数据结构或契约。 */
export interface AgentRunRecord {
  /** 从请求外键反查，不在运行表重复保存数组。 */
  readonly requestIds?: readonly string[];
  readonly billingCalls?: readonly ModelBilling[] | null;
  readonly id: string;
  readonly agentKey: string;
  readonly definitionHash: string;
  readonly modelConfigHash: string;
  readonly inputHash: string;
  readonly cacheKey: string;
  readonly status: AgentRunStatus;
  readonly output: unknown;
  readonly outputHash: string | null;
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
  readonly billingCalls?: readonly ModelBilling[] | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimatedCostMicros: number | null;
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
  /** 单个请求开始/结束即时写入独立账本，不等待运行结束。 */
  saveModelRequest(agentRunId: string, record: ModelRequestRecord): void;
  get(id: string): AgentRunRecord | null;
  findSucceeded(cacheKey: string): AgentRunRecord | null;
  /** 将校验失败的成功缓存失效，保留输出和用量作为审计。 */
  invalidateSucceeded(id: string): void;
  createRunning(record: AgentRunRecord): void;
  /** 恢复相同执行键的失败记录；返回原用量供累计，禁止接管仍在运行的记录。 */
  restartFailed(cacheKey: string, startedAt: number): AgentRunRecord | null;
  /** 重试保留历史工具调用，序号继续递增。 */
  nextToolSequence(agentRunId: string): number;
  completeSucceeded(input: {
    readonly id: string;
    readonly cacheKey: string;
    readonly output: unknown;
    readonly outputHash: string;
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

/** 维护已完成运行的缺失成本；预期时间和用量用于阻止并发覆盖。 */
export interface AgentRunCostCorrectionStore {
  backfillUnpricedCost(input: {
    readonly id: string;
    readonly startedAt: number;
    readonly usage: AgentRunUsage;
  }): boolean;
}
