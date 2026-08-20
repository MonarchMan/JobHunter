import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { describe, expect, it } from 'vitest';
import { OpenAiCompatibleModelClient } from '../src/index.js';

const online = process.env.JOBHUNTER_ONLINE_MODEL === '1';

describe.skipIf(!online)('OpenAI-compatible controlled online smoke', () => {
  it('returns one minimal structured response using explicit local credentials', async () => {
    const local = parseEnv(readFileSync('.env', 'utf8'));
    const baseUrl = local.JOBHUNTER_MODEL_BASE_URL ?? local.BASE_URL;
    const apiKey = local.JOBHUNTER_MODEL_API_KEY ?? local.API_KEY;
    const model = local.JOBHUNTER_MODEL_NAME ?? local.MODEL;
    expect(baseUrl, 'BASE_URL is required for online model smoke').toBeTruthy();
    expect(apiKey, 'API_KEY is required for online model smoke').toBeTruthy();
    expect(model, 'MODEL is required for online model smoke').toBeTruthy();
    if (!baseUrl || !apiKey || !model) return;

    const client = new OpenAiCompatibleModelClient({ baseUrl, apiKey, model, timeoutMs: 60_000 });
    const response = await client.complete(
      {
        systemPrompt: 'Return only the requested JSON object.',
        input: { instruction: 'Set ok to true.' },
        outputSchemaName: 'SmokeResult',
        outputJsonSchema: {
          type: 'object',
          properties: { ok: { type: 'boolean' } },
          required: ['ok'],
          additionalProperties: false,
        },
        maxOutputTokens: 256,
        tools: [],
        toolResults: [],
      },
      AbortSignal.timeout(60_000),
    );
    expect(response).toMatchObject({ kind: 'output', output: { ok: true } });
  }, 70_000);
});
