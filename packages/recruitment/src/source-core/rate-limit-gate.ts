import {
  TokenBucketSourceRateLimitGate as CommonTokenBucket,
  type SourceRateLimitPolicy,
} from '@jobhunter/common/source-rate-limit';
import { SourceError } from './errors.js';
export type { SourceRateLimitPolicy } from '@jobhunter/common/source-rate-limit';

/** 来源模块保留业务错误契约，令牌桶算法由 common 统一提供。 */
export class TokenBucketSourceRateLimitGate extends CommonTokenBucket {
  constructor(
    policies: ReadonlyMap<string, SourceRateLimitPolicy>,
    options: { readonly now?: () => number } = {},
  ) {
    super(policies, options);
  }
  override async beforeRequest(input: {
    readonly sourceKey: string;
    readonly signal: AbortSignal;
  }): Promise<void> {
    try {
      await super.beforeRequest(input);
    } catch {
      throw new SourceError('temporary', 'Source request was cancelled while rate limited.');
    }
  }
}
