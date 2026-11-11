import { resolveModelPricing, type ModelPricingInput } from '../../src/config/model-pricing.js';
import type { ModelBilling } from '../../src/contracts/model-usage.js';
import { calculateBilling as calculate, type BillingInput } from '../../src/models/billing.js';

/** 模拟适配器先选价再计算的流程，供跨供应商计费回归使用。 */
export function calculateBilling(input: BillingInput & ModelPricingInput): ModelBilling {
  return calculate(input, resolveModelPricing(input));
}
