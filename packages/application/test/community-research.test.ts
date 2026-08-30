import {
  communityResearchSchemaVersion,
  researchRequestFingerprint,
  type CommunityResearchBundle,
  type ExperienceResearchBrief,
} from '@jobhunter/domain';
import { describe, expect, it } from 'vitest';
import {
  communityResearchJsonSchema,
  normalizeCommunityResearchBundle,
  renderCommunityResearchPrompt,
} from '../src/interview/index.js';

const brief: ExperienceResearchBrief = {
  targetRoles: ['后端工程师'],
  companies: [],
  locations: [],
  levels: [],
  stages: [],
  dateFrom: null,
  dateTo: null,
  language: 'zh-CN',
  maxSources: 2,
  maxQuestionsPerSource: 2,
  allowedDomains: ['example.com'],
  blockedDomains: ['ads.example.com'],
};

function bundle(): CommunityResearchBundle {
  const fingerprint = researchRequestFingerprint(brief);
  return {
    schemaVersion: communityResearchSchemaVersion,
    requestFingerprint: fingerprint,
    generatedAt: '2026-08-30T08:00:00.000Z',
    sources: [
      {
        url: 'https://EXAMPLE.com/interview/1#questions',
        title: '后端面试经历',
        publishedAt: null,
        retrievedAt: '2026-08-30T07:00:00.000Z',
      },
    ],
    experiences: [
      {
        company: '示例科技',
        role: '后端工程师',
        stage: '一面',
        occurredAt: null,
        sourceUrl: 'https://example.com/interview/1',
        questions: [
          {
            text: '如何  定位\n慢查询？',
            answerExcerpt: '原文只提到了执行计划。',
            topics: ['数据库', '数据库'],
            evidenceExcerpt: '面试官追问了慢查询的定位思路。',
          },
          {
            text: '如何 定位 慢查询?',
            answerExcerpt: null,
            topics: ['SQL'],
            evidenceExcerpt: '面试官追问了慢查询的定位思路。',
          },
        ],
      },
    ],
    warnings: [],
  };
}

describe('community research prompt and normalization', () => {
  it('renders a frozen prompt and a strict machine-readable output schema', () => {
    const fingerprint = researchRequestFingerprint(brief);
    const prompt = renderCommunityResearchPrompt(brief, fingerprint);
    const schema = communityResearchJsonSchema();

    expect(prompt).toContain(fingerprint);
    expect(prompt).toContain('不得补写标准答案');
    expect(prompt).toContain('不得调用 Shell、终端、本地文件');
    expect(schema).toMatchObject({ type: 'object' });
  });

  it('canonicalizes source URLs and removes only exact duplicate questions', () => {
    const normalized = normalizeCommunityResearchBundle({
      value: bundle(),
      brief,
      expectedFingerprint: researchRequestFingerprint(brief),
    });

    expect(normalized.sources[0]?.url).toBe('https://example.com/interview/1');
    expect(normalized.experiences[0]?.questions).toEqual([
      expect.objectContaining({
        text: '如何 定位 慢查询?',
        answerExcerpt: '原文只提到了执行计划。',
        topics: ['数据库'],
      }),
    ]);
  });

  it('rejects fingerprint, domain and per-source limit violations', () => {
    const value = bundle();
    expect(() =>
      normalizeCommunityResearchBundle({
        value: { ...value, requestFingerprint: '0'.repeat(64) },
        brief,
        expectedFingerprint: researchRequestFingerprint(brief),
      }),
    ).toThrow(/fingerprint/u);
    expect(() =>
      normalizeCommunityResearchBundle({
        value: {
          ...value,
          sources: [{ ...value.sources[0], url: 'https://outside.example.org/interview/1' }],
          experiences: [
            { ...value.experiences[0], sourceUrl: 'https://outside.example.org/interview/1' },
          ],
        },
        brief,
        expectedFingerprint: researchRequestFingerprint(brief),
      }),
    ).toThrow(/allowed domains/u);
    expect(() =>
      normalizeCommunityResearchBundle({
        value: {
          ...value,
          experiences: [
            ...value.experiences,
            {
              ...value.experiences[0],
              questions: [
                {
                  ...value.experiences[0].questions[0],
                  text: '如何设计备份策略？',
                },
                {
                  ...value.experiences[0].questions[0],
                  text: '如何验证恢复流程？',
                },
              ],
            },
          ],
        },
        brief,
        expectedFingerprint: researchRequestFingerprint(brief),
      }),
    ).toThrow(/per-source question limit/u);
  });
});
