import { AgentRunner } from '@jobhunter/agent-core';
import { openSqliteDatabase, SqliteAgentRunStore } from '@jobhunter/db';
import type { CommunityResearchBundle } from '@jobhunter/domain';
import { FakeModelClient } from '@jobhunter/llm';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  finalizeBrowserResearchBundle,
  type BrowserResearchTraceEntry,
} from '../src/codex-research-executor.js';
import { ConfiguredModelResearchExecutor } from '../src/configured-model-research-executor.js';
import type { ResearchBrowserGateway } from '../src/research-browser-gateway.js';

const sourceUrl = 'https://www.nowcoder.com/discuss/123456';
const question = 'SFT 训练不稳定时如何排查和优化？';
const retrievedAt = '2026-09-29T08:00:00.000Z';

/** 构造配置模型输出的标准研究包。 */
function researchBundle(
  questionText = question,
  answerExcerpt: string | null = null,
): CommunityResearchBundle {
  return {
    schemaVersion: 'community-research-bundle@v2',
    requestFingerprint: 'a'.repeat(64),
    generatedAt: retrievedAt,
    sources: [{ url: sourceUrl, title: '模型标题', publishedAt: null, retrievedAt }],
    experiences: [
      {
        company: null,
        role: '大模型算法',
        stage: null,
        occurredAt: null,
        sourceUrl,
        questions: [{ text: questionText, answerExcerpt, topics: ['SFT'] }],
      },
    ],
    warnings: [],
  } as const;
}

/** 构造本次采集的瞬时来源与正文回溯记录。 */
function researchTrace(bodyText = `面试问题：${question}`): readonly BrowserResearchTraceEntry[] {
  return [
    {
      tool: 'open',
      ok: true,
      finalUrl: sourceUrl,
      title: '大模型算法面经',
      retrievedAt,
    },
    {
      tool: 'readPage',
      ok: true,
      finalUrl: sourceUrl,
      title: '大模型算法面经',
      retrievedAt,
      bodyText,
    },
  ];
}

/** 构造包含可逐字回溯问题的受限浏览器测试替身。 */
function gateway(onClose: () => void): ResearchBrowserGateway {
  const bodyText = `面试问题：${question}`;
  return {
    url: 'http://127.0.0.1:43210/mcp',
    bearerToken: 'fixture-token',
    collectPages: () =>
      Promise.resolve([
        {
          query: '大模型算法 面经',
          searchRank: 1,
          finalUrl: sourceUrl,
          title: '大模型算法面经',
          retrievedAt,
          bodyText,
          bodySha256: 'a'.repeat(64),
          bodyLength: bodyText.length,
        },
      ]),
    readTrace: () =>
      researchTrace(bodyText).map((entry, index) => ({
        ...entry,
        sequence: index + 1,
        occurredAt: retrievedAt,
      })),
    close: () => {
      onClose();
      return Promise.resolve();
    },
  };
}

describe('ConfiguredModelResearchExecutor', () => {
  it('由 Worker 采集证据并在模型输出后执行逐字回溯', async () => {
    const dataRoot = await mkdtemp(path.join(tmpdir(), 'jobhunter-configured-research-test-'));
    const database = openSqliteDatabase({ dataRoot });
    let sequence = 0;
    let closeCount = 0;
    const bundle = researchBundle();
    const model = new FakeModelClient([
      {
        kind: 'output',
        output: bundle,
        usage: { inputTokens: 100, outputTokens: 50, estimatedCostMicros: 10 },
      },
    ]);
    const runner = new AgentRunner({
      store: new SqliteAgentRunStore(database.client),
      model,
      createId: () => `018f0000-0000-7000-8000-${String(++sequence).padStart(12, '0')}`,
      now: () => Date.parse(retrievedAt),
    });
    const executor = new ConfiguredModelResearchExecutor(runner, {
      startBrowserGateway: () => Promise.resolve(gateway(() => (closeCount += 1))),
    });

    try {
      const result = await executor.execute(
        {
          requestId: '018f0000-0000-7000-8000-000000000024',
          promptVersion: 'community-research-prompt@v4',
          prompt: '研究公开面经并输出 JSON。',
          outputSchema: { type: 'object' },
          collectionPlan: {
            version: 'community-browser-collection@v2',
            queries: ['大模型算法 面经'],
            priorityQueryCount: 0,
            relevanceTerms: ['大模型算法'],
            maximumSources: 1,
          },
          browserPolicy: {
            allowedDomains: [],
            blockedDomains: [],
            maximumSearches: 3,
            maximumPages: 5,
            maximumReadCalls: 5,
            maximumPageCharacters: 40_000,
            maximumTotalCharacters: 40_000,
            navigationTimeoutMs: 20_000,
          },
          maximumOutputBytes: 2 * 1024 * 1024,
          timeoutMs: 15 * 60_000,
        },
        new AbortController().signal,
      );

      expect(closeCount).toBe(1);
      expect(model.requests).toHaveLength(1);
      expect(model.requests[0]?.tools).toEqual([]);
      expect(JSON.stringify(model.requests[0]?.input)).toContain(question);
      expect(JSON.parse(result.bundleText)).toMatchObject({
        sources: [{ title: '模型标题' }],
        experiences: [{ questions: [{ text: question }] }],
      });
      expect(result.externalSessionId).toMatch(/^018f/);
    } finally {
      database.close();
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  it('拒绝无法从本次页面正文逐字回溯的问题', () => {
    expect(() =>
      finalizeBrowserResearchBundle(
        JSON.stringify(researchBundle('解释 PPO clipped objective 的推导。')),
        researchTrace(),
      ),
    ).toThrow('Browser research result has no interview questions backed by this browser trace.');
  });

  it('清空无法从本次页面正文证明的答案摘录', () => {
    const finalized = JSON.parse(
      finalizeBrowserResearchBundle(
        JSON.stringify(researchBundle(question, '这是模型自行补写的答案。')),
        researchTrace(),
      ),
    ) as {
      readonly experiences: readonly {
        readonly questions: readonly { readonly answerExcerpt: string | null }[];
      }[];
      readonly warnings: readonly string[];
    };
    expect(finalized.experiences[0]?.questions[0]?.answerExcerpt).toBeNull();
    expect(finalized.warnings).toContainEqual(expect.stringContaining('清空 1 个'));
  });
});
