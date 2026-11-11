import { describe, expect, it } from 'vitest';
import { calculateBilling } from './fixtures/calculate-model-billing.js';
import { resolveCatalogPricing } from '../src/config/pricing-catalog.js';
import {
  AnthropicModelClient,
  OpenAiCompatibleModelClient,
  createConfiguredModelClient,
} from '../src/models/index.js';
import { resolveAppConfig, resolveBootstrapConfig } from '../src/config/index.js';

const usage = {
  model: 'glm-4-plus',
  baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
  currency: 'CNY' as const,
  requestedAt: Date.parse('2026-11-01T12:00:00Z'),
  inputTokens: 1000,
  outputTokens: 100,
  cacheReadTokens: 600,
  cacheWriteTokens: 0,
  uncachedInputTokens: 400,
};
const request = {
  systemPrompt: 'test',
  input: {},
  outputSchemaName: 'test',
  outputJsonSchema: { type: 'object' },
  tools: [],
  toolResults: [],
};

/** 构造无网络的供应商响应，验证真实适配器边界。 */
function response(body: unknown): typeof fetch {
  return () => Promise.resolve(new Response(JSON.stringify(body)));
}

describe('multi-provider cache pricing', () => {
  it('defaults domestic endpoints to CNY and preserves an explicit currency', () => {
    const bootstrap = resolveBootstrapConfig({ environment: {} });
    const environment = {
      MODEL: 'glm-5.3-flash',
      BASE_URL: 'https://open.bigmodel.cn/api/paas/v4',
    };
    expect(resolveAppConfig({ bootstrap, environment }).model.costCurrency).toEqual({
      value: 'CNY',
      source: 'default',
    });
    expect(
      resolveAppConfig({ bootstrap, environment: { ...environment, MODEL_COST_CURRENCY: 'USD' } })
        .model.costCurrency.value,
    ).toBe('USD');
    expect(
      resolveAppConfig({ bootstrap, environment: { ...environment, MODEL_COST_CURRENCY: 'USD' } })
        .model.inputCostPerMillionUsd.value,
    ).toBeNull();
  });

  it.each([true, false])(
    'reads Kimi TTL headers while missing headers stay null (%s)',
    async (hasHeaders) => {
      const client = new OpenAiCompatibleModelClient({
        model: 'kimi-k3',
        baseUrl: 'https://api.moonshot.cn/v1',
        apiKey: 'fake',
        costCurrency: 'CNY',
        fetchImplementation: () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                choices: [{ message: { content: '{}' } }],
                usage: {
                  prompt_tokens: 2000,
                  completion_tokens: 100,
                  prompt_tokens_details: { cached_tokens: 600, cache_write_tokens: 1000 },
                },
              }),
              {
                headers: hasHeaders
                  ? {
                      'Msh-Usage-Cache-Write-Tokens-5m': '400',
                      'Msh-Usage-Cache-Write-Tokens-1h': '600',
                    }
                  : {},
              },
            ),
          ),
      });
      const result = await client.complete(request, new AbortController().signal);
      expect(result.usage.billing).toMatchObject({
        cacheWriteTokens: 1000,
        cacheWrite5mTokens: hasHeaders ? 400 : null,
        cacheWrite1hTokens: hasHeaders ? 600 : null,
        totalCostMicros: hasHeaders ? 51200 : null,
      });
    },
  );
  it.each([
    ['glm-4-plus', 'open.bigmodel.cn', 4000],
    ['glm-5.3-flash', 'open.bigmodel.cn', 738],
    ['kimi-k2.6', 'api.moonshot.cn', 5960],
    ['minimax-m3', 'api.minimax.cn', 1932],
  ])('prices %s cache reads without counting them twice', (model, host, cost) => {
    expect(calculateBilling({ ...usage, model, baseUrl: `https://${host}` }).totalCostMicros).toBe(
      cost,
    );
  });

  it('does not mix currencies, regions, gateways or subscription endpoints', () => {
    for (const change of [
      { currency: 'USD' as const },
      { baseUrl: 'https://proxy.test' },
      { model: 'glm-5.3', baseUrl: 'https://api.z.ai/api/paas/v4' },
      { model: 'glm-5.3', baseUrl: 'https://api.z.ai/api/coding/paas/v4' },
      { serviceTier: 'priority' },
      { model: 'unknown-model' },
    ])
      expect(calculateBilling({ ...usage, ...change }).totalCostMicros).toBeNull();
  });

  it('uses total input to pick the MiniMax long-context tier', () => {
    const base = { ...usage, model: 'minimax-m3', baseUrl: 'https://api.minimax.cn' };
    expect(resolveCatalogPricing({ ...base, inputTokens: 512_000 })?.prices).toEqual([
      2.1, 8.4, 0.42, 0, 0,
    ]);
    expect(resolveCatalogPricing({ ...base, inputTokens: 512_001 })?.prices).toEqual([
      4.2, 16.8, 0.84, 0, 0,
    ]);
    expect(resolveCatalogPricing({ ...base, inputTokens: null })).toBeNull();
  });

  it('prices Qwen Beijing by native currency, mode and total context', () => {
    const base = {
      ...usage,
      model: 'qwen-plus',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      currency: 'CNY' as const,
    };
    expect(calculateBilling({ ...base, thinking: false }).totalCostMicros).toBe(616);
    expect(calculateBilling({ ...base, thinking: true }).totalCostMicros).toBe(1216);
    expect(calculateBilling(base).totalCostMicros).toBeNull();
    expect(
      resolveCatalogPricing({ ...base, inputTokens: 128_001, thinking: false })?.prices,
    ).toEqual([2.4, 20, 0.48, null, null]);
    expect(
      resolveCatalogPricing({ ...base, inputTokens: 256_001, thinking: true })?.prices,
    ).toEqual([4.8, 64, 0.96, null, null]);
    expect(
      resolveCatalogPricing({
        ...base,
        baseUrl: 'https://dashscope-intl.aliyuncs.com',
        thinking: false,
      }),
    ).toBeNull();
  });

  it('applies custom prices per component and honors explicit zero cache prices', () => {
    expect(calculateBilling({ ...usage, inputPrice: 1, outputPrice: 2 }).totalCostMicros).toBe(
      2100,
    );
    expect(
      calculateBilling({ ...usage, inputPrice: 1, outputPrice: 2, cacheReadPrice: 0 })
        .totalCostMicros,
    ).toBe(600);
    expect(calculateBilling({ ...usage, cacheReadPrice: 0 }).totalCostMicros).toBe(2500);
    expect(calculateBilling({ ...usage, cacheReadPrice: null }).totalCostMicros).toBeNull();
  });

  it('keeps BigModel CNY distinct from Z.ai USD and prices input/output thresholds', () => {
    const base = {
      ...usage,
      model: 'glm-4.7',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      currency: 'CNY' as const,
    };
    expect(
      resolveCatalogPricing({ ...base, inputTokens: 31_999, outputTokens: 199 })?.prices,
    ).toEqual([2, 8, 0.4, 0, 0]);
    expect(
      resolveCatalogPricing({ ...base, inputTokens: 31_999, outputTokens: 200 })?.prices,
    ).toEqual([3, 14, 0.6, 0, 0]);
    expect(resolveCatalogPricing({ ...base, inputTokens: 32_000 })?.prices).toEqual([
      4, 16, 0.8, 0, 0,
    ]);
    expect(resolveCatalogPricing({ ...base, outputTokens: null })).toBeNull();
    expect(calculateBilling({ ...base, model: 'glm-5.3-flash' }).totalCostMicros).toBe(738);
  });

  it('separates Kimi five-minute and one-hour writes and rejects conflicting durations', () => {
    const input = {
      ...usage,
      model: 'kimi-k3',
      baseUrl: 'https://api.moonshot.cn/anthropic',
      inputTokens: 2000,
      cacheWriteTokens: 1000,
      cacheWrite5mTokens: 400,
      cacheWrite1hTokens: 600,
    };
    expect(calculateBilling(input)).toMatchObject({
      inputCostMicros: 8000,
      cacheReadCostMicros: 1200,
      cacheWrite5mCostMicros: 8000,
      cacheWrite1hCostMicros: 24000,
      cacheWriteCostMicros: 32000,
      outputCostMicros: 10000,
      totalCostMicros: 51200,
    });
    expect(
      calculateBilling({ ...input, cacheWrite5mTokens: null, cacheWrite1hTokens: null }),
    ).toMatchObject({ cacheWrite5mTokens: null, cacheWrite1hTokens: null, totalCostMicros: null });
    expect(() => calculateBilling({ ...input, cacheWrite1hTokens: 900 })).toThrow();
    expect(() => calculateBilling({ ...input, cacheWrite1hTokens: 0 })).toThrow();
  });

  it('normalizes domestic Anthropic-compatible usage and does not subtract fresh input twice', async () => {
    const client = new AnthropicModelClient({
      costCurrency: 'CNY',
      model: 'kimi-k3',
      baseUrl: 'https://api.moonshot.cn/anthropic',
      apiKey: 'fake',
      fetchImplementation: response({
        content: [{ type: 'text', text: '{}' }],
        usage: {
          input_tokens: 400,
          output_tokens: 100,
          cache_read_input_tokens: 600,
          cache_creation_input_tokens: 1000,
          cache_creation: { ephemeral_5m_input_tokens: 400, ephemeral_1h_input_tokens: 600 },
        },
      }),
    });
    const result = await client.complete(request, new AbortController().signal);
    expect(result.usage).toMatchObject({
      inputTokens: 2000,
      estimatedCostMicros: 51200,
      billing: { cacheWrite1hTokens: 600, uncachedInputTokens: 400 },
    });
  });

  it.each([null, 0, 600])(
    'reads OpenAI-compatible top-level cache fields preserving %s',
    async (cached) => {
      const client = new OpenAiCompatibleModelClient({
        model: usage.model,
        baseUrl: usage.baseUrl,
        apiKey: 'fake',
        fetchImplementation: response({
          choices: [{ message: { content: '{}' } }],
          usage: {
            prompt_tokens: 1000,
            completion_tokens: 100,
            ...(cached === null ? {} : { cache_read_input_tokens: cached }),
            cache_creation_input_tokens: 0,
          },
        }),
      });
      const result = await client.complete(request, new AbortController().signal);
      expect(result.usage.billing?.cacheReadTokens).toBe(cached);
      expect(result.usage.billing?.cacheWriteTokens).toBe(0);
    },
  );

  it('explicit zero wins over a lower-priority compatibility field', async () => {
    const client = new OpenAiCompatibleModelClient({
      model: usage.model,
      baseUrl: usage.baseUrl,
      apiKey: 'fake',
      fetchImplementation: response({
        choices: [{ message: { content: '{}' } }],
        usage: {
          prompt_tokens: 1000,
          completion_tokens: 100,
          cache_read_input_tokens: 0,
          prompt_tokens_details: { cached_tokens: 600 },
        },
      }),
    });
    expect(
      (await client.complete(request, new AbortController().signal)).usage.billing?.cacheReadTokens,
    ).toBe(0);
  });

  it('validates and wires environment cache prices into the provider registry', () => {
    const environment = {
      MODEL: 'custom',
      BASE_URL: 'https://proxy.test',
      MODEL_CACHE_READ_COST_PER_MILLION: '0',
      MODEL_CACHE_WRITE_COST_PER_MILLION: '1.25',
      MODEL_CACHE_WRITE_1H_COST_PER_MILLION: '2',
    };
    const config = resolveAppConfig({
      bootstrap: resolveBootstrapConfig({ environment: {} }),
      environment,
    });
    expect(config.model.cacheReadPrice).toEqual({ value: 0, source: 'environment' });
    expect(config.model.cacheWrite1hPrice.value).toBe(2);
    expect(() =>
      createConfiguredModelClient({
        provider: config.model.provider.value,
        model: 'custom',
        baseUrl: config.model.baseUrl.value,
        apiKey: 'fake',
        cacheReadPrice: config.model.cacheReadPrice.value,
        cacheWritePrice: config.model.cacheWritePrice.value,
        cacheWrite1hPrice: config.model.cacheWrite1hPrice.value,
      }),
    ).not.toThrow();
    expect(() =>
      resolveAppConfig({
        bootstrap: config.bootstrap,
        environment: { MODEL_CACHE_READ_COST_PER_MILLION: '-1' },
      }),
    ).toThrow();
  });
});
