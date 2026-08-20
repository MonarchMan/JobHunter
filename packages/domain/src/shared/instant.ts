import { z } from 'zod';
import { DomainError } from './domain-error.js';

declare const utcInstantBrand: unique symbol;
export type UtcInstant = number & { readonly [utcInstantBrand]: true };

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

export const utcInstantSchema: z.ZodType<UtcInstant> = z
  .number()
  .int()
  .nonnegative()
  .transform((value) => value as UtcInstant);
