import { describe, expect, it } from 'vitest';
import { resolveLegacyDomesticPricing } from '../src/models/legacy-domestic-pricing.js';
import { calculateBilling } from '../src/models/billing.js';
import { resolveAppConfig, resolveBootstrapConfig } from '../src/config/index.js';
import { OpenAiCompatibleModelClient } from '../src/models/index.js';

const usage = {
  model: 'MiniMax-M2.1',
  baseUrl: 'https://api.minimax.cn/v1',
  currency: 'USD' as const,
  requestedAt: Date.parse('2026-11-01T12:00:00Z'),
  inputTokens: 1000,
  outputTokens: 100,
  cacheReadTokens: 600,
  cacheWriteTokens: 0,
  uncachedInputTokens: 400,
};

describe('legacy domestic USD reference pricing', () => {
  it.each(['minimax-m2', 'minimax-m2.1', 'minimax-m2.5'])(
    'uses cc-switch prices for %s',
    (model) => {
      expect(calculateBilling({ ...usage, model })).toMatchObject({
        currency: 'USD',
        totalCostMicros: 258,
        pricingVersion: `cc-switch-8be8405-usd-reference-${model}`,
      });
    },
  );
  it('prices writes and preserves missing counts', () => {
    expect(
      calculateBilling({ ...usage, inputTokens: 2000, cacheWriteTokens: 1000 }).totalCostMicros,
    ).toBe(633);
    expect(
      calculateBilling({
        ...usage,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        uncachedInputTokens: null,
      }),
    ).toMatchObject({
      cacheReadTokens: null,
      cacheWriteTokens: null,
      totalCostMicros: 420,
      precision: 'cache-miss-assumed',
    });
    expect(calculateBilling({ ...usage, model: 'minimax-m2.7' }).totalCostMicros).toBe(276);
    expect(
      calculateBilling({ ...usage, model: 'kimi-k2.5', baseUrl: 'https://api.moonshot.cn' })
        .totalCostMicros,
    ).toBe(600);
  });
  it.each([
    ['minimax-m3', 'https://api.minimax.cn'],
    ['kimi-k2.6', 'https://api.moonshot.cn'],
    ['kimi-k2.7-code', 'https://api.moonshot.cn'],
    ['kimi-k3.1-pro', 'https://api.moonshot.cn'],
    ['glm-4.7', 'https://open.bigmodel.cn'],
    ['qwen-plus', 'https://dashscope.aliyuncs.com'],
  ])('never replaces current domestic pricing for %s', (model, baseUrl) => {
    expect(resolveLegacyDomesticPricing(model, baseUrl)).toBeNull();
    expect(
      calculateBilling({ ...usage, model, baseUrl, inputTokens: null, uncachedInputTokens: null })
        .pricingVersion,
    ).not.toContain('usd-reference');
    const config = resolveAppConfig({
      bootstrap: resolveBootstrapConfig({ environment: {} }),
      environment: { MODEL: model, BASE_URL: baseUrl },
    });
    expect(config.model.costCurrency.value).toBe('CNY');
  });
  it('keeps overrides, currencies, unknown models and unsupported tiers isolated', () => {
    expect(calculateBilling({ ...usage, currency: 'CNY' }).totalCostMicros).toBeNull();
    expect(
      calculateBilling({
        ...usage,
        currency: 'CNY',
        inputPrice: 1,
        outputPrice: 2,
        cacheReadPrice: 0.1,
      }),
    ).toMatchObject({ currency: 'CNY', totalCostMicros: 660, pricingVersion: 'configured-v2' });
    expect(calculateBilling({ ...usage, serviceTier: 'priority' }).totalCostMicros).toBeNull();
    for (const [model, baseUrl] of [
      ['minimax-m2.9', usage.baseUrl],
      [usage.model, 'https://proxy.test'],
      [usage.model, 'https://api.minimax.cn/coding/v1'],
    ]) {
      expect(resolveLegacyDomesticPricing(model ?? '', baseUrl ?? '')).toBeNull();
    }
  });
  it('carries the USD currency from configuration through adapter metadata and response', async () => {
    const config = resolveAppConfig({
      bootstrap: resolveBootstrapConfig({ environment: {} }),
      environment: { MODEL: usage.model, BASE_URL: usage.baseUrl },
    });
    expect(config.model.costCurrency).toEqual({ value: 'USD', source: 'default' });
    const client = new OpenAiCompatibleModelClient({
      model: usage.model,
      baseUrl: usage.baseUrl,
      apiKey: 'fake',
      costCurrency: config.model.costCurrency.value,
      inputCostPerMillionUsd: config.model.inputCostPerMillionUsd.value,
      outputCostPerMillionUsd: config.model.outputCostPerMillionUsd.value,
      autoModelPricing: true,
      fetchImplementation: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [{ message: { content: '{}' } }],
              usage: {
                prompt_tokens: 1000,
                completion_tokens: 100,
                prompt_tokens_details: { cached_tokens: 600 },
              },
            }),
          ),
        ),
    });
    expect(client.metadata.costCurrency).toBe('USD');
    const result = await client.complete(
      {
        systemPrompt: 'test',
        input: {},
        outputSchemaName: 'test',
        outputJsonSchema: {},
        tools: [],
        toolResults: [],
      },
      new AbortController().signal,
    );
    expect(result.usage.billing).toMatchObject({ currency: 'USD', totalCostMicros: 258 });
  });
});
