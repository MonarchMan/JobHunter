import type { CompanyId, UtcInstant } from '../shared/index.js';

export interface Company {
  readonly id: CompanyId;
  readonly canonicalName: string;
  readonly aliases: readonly string[];
  readonly industry: string | null;
  readonly sizeCategory: 'large' | 'medium' | 'other';
  readonly enabled: boolean;
  readonly createdAt: UtcInstant;
  readonly updatedAt: UtcInstant;
}
