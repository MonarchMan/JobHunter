import { describe, expect, it } from 'vitest';
import { calculateBilling, deepSeekPeriod } from '../src/models/billing.js';
import { OpenAiCompatibleModelClient, AnthropicModelClient } from '../src/models/index.js';

const base = {
  model: 'deepseek-flash',
  baseUrl: 'https://api.deepseek.com',
  requestedAt: Date.parse('2026-10-30T14:49:41Z'),
  currency: 'USD' as const,
  inputTokens: 1000,
  outputTokens: 100,
  cacheReadTokens: 600,
  cacheWriteTokens: null,
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

describe('per-request cached billing', () => {
  it.each([
    ['2026-10-30T00:59:59Z', 'off-peak'],
    ['2026-10-30T01:00:00Z', 'peak'],
    ['2026-10-30T04:00:00Z', 'off-peak'],
    ['2026-10-30T06:00:00Z', 'peak'],
    ['2026-10-30T10:00:00Z', 'off-peak'],
    ['2026-10-31T02:00:00Z', 'off-peak'],
    ['2026-10-01T02:00:00Z', 'off-peak'],
    ['2026-09-25T02:00:00Z', 'off-peak'],
    ['2027-01-04T02:00:00Z', 'unknown'],
  ])('maps Beijing calendar at %s', (date, period) => {
    expect(deepSeekPeriod(Date.parse(date))).toBe(period);
  });
  it('separates cached input without double billing and uses official CNY rates', () => {
    expect(calculateBilling(base)).toMatchObject({
      inputCostMicros: 60,
      cacheReadCostMicros: 2,
      outputCostMicros: 60,
      totalCostMicros: 122,
      precision: 'reported',
    });
    expect(calculateBilling({ ...base, currency: 'CNY' }).totalCostMicros).toBe(812);
    expect(
      calculateBilling({ ...base, requestedAt: Date.parse('2026-10-30T02:00:00Z') })
        .totalCostMicros,
    ).toBe(244);
  });
  it('preserves missing cache fields and explicit zero separately', () => {
    expect(
      calculateBilling({ ...base, cacheReadTokens: null, uncachedInputTokens: null }),
    ).toMatchObject({
      cacheReadTokens: null,
      uncachedInputTokens: null,
      totalCostMicros: 210,
      precision: 'cache-miss-assumed',
    });
    expect(
      calculateBilling({ ...base, cacheReadTokens: 0, uncachedInputTokens: 1000 }),
    ).toMatchObject({ cacheReadTokens: 0, totalCostMicros: 210, precision: 'reported' });
  });
  it('honors explicit prices and leaves unknown calendar, provider, or usage unpriced', () => {
    expect(
      calculateBilling({ ...base, inputPrice: 1, outputPrice: 2, cacheReadPrice: 0.1 })
        .totalCostMicros,
    ).toBe(660);
    expect(calculateBilling({ ...base, baseUrl: 'https://proxy.test' }).totalCostMicros).toBeNull();
    expect(
      calculateBilling({ ...base, requestedAt: Date.parse('2027-01-04T02:00:00Z') })
        .totalCostMicros,
    ).toBeNull();
    expect(
      calculateBilling({
        ...base,
        inputTokens: null,
        uncachedInputTokens: null,
        cacheReadTokens: null,
      }).totalCostMicros,
    ).toBeNull();
    expect(() => calculateBilling({ ...base, cacheReadTokens: 1001 })).toThrow();
  });
  it.each([null, 0, 600])(
    'reads the authoritative DeepSeek field without losing %s',
    async (hit) => {
      const client = new OpenAiCompatibleModelClient({
        baseUrl: base.baseUrl,
        apiKey: 'fake',
        model: base.model,
        now: () => base.requestedAt,
        fetchImplementation: () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                choices: [{ message: { content: '{}' }, finish_reason: 'stop' }],
                usage: {
                  prompt_tokens: 1000,
                  completion_tokens: 100,
                  ...(hit === null ? {} : { prompt_cache_hit_tokens: hit }),
                },
              }),
            ),
          ),
      });
      const response = await client.complete(request, new AbortController().signal);
      expect(response.usage.billing?.cacheReadTokens).toBe(hit);
      expect(response.usage.billing?.uncachedInputTokens).toBe(hit === null ? null : 1000 - hit);
    },
  );
  it('does not subtract Anthropic cached tokens from its fresh input', async () => {
    const client = new AnthropicModelClient({
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'fake',
      model: 'test',
      inputCostPerMillionUsd: 1,
      outputCostPerMillionUsd: 2,
      cacheReadPrice: 0.1,
      cacheWritePrice: 1.25,
      fetchImplementation: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              content: [{ type: 'text', text: '{}' }],
              usage: {
                input_tokens: 400,
                output_tokens: 100,
                cache_read_input_tokens: 600,
                cache_creation_input_tokens: 0,
              },
            }),
          ),
        ),
    });
    const result = await client.complete(request, new AbortController().signal);
    expect(result.usage).toMatchObject({
      inputTokens: 1000,
      estimatedCostMicros: 660,
      billing: { uncachedInputTokens: 400, cacheReadTokens: 600, cacheWriteTokens: 0 },
    });
  });
});
