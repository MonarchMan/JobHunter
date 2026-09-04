import { z } from 'zod';
import { DomainError } from './domain-error.js';

declare const utcInstantBrand: unique symbol;
/** 领域模型的类型约束。 */
export type UtcInstant = number & { readonly [utcInstantBrand]: true };

/** 将 Date 或毫秒数校验为领域时间戳。 */
export function utcInstant(value: number | Date): UtcInstant {
  const milliseconds = value instanceof Date ? value.valueOf() : value;
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
    throw new DomainError(
      'INVALID_DOMAIN_VALUE',
      'UTC instant must be a non-negative epoch millisecond.',
    );
  }
  return milliseconds as UtcInstant;
}

/** 外部输入使用的领域时间戳 Schema。 */
export const utcInstantSchema: z.ZodType<UtcInstant> = z
  .number()
  .int()
  .nonnegative()
  .transform((value) => value as UtcInstant);
