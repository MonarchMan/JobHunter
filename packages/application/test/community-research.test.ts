import {
  communityResearchPromptVersion,
  communityResearchSchemaVersion,
  researchRequestFingerprint,
  type CommunityResearchBundle,
  type ExperienceResearchBrief,
} from '@jobhunter/domain';
import { describe, expect, it } from 'vitest';
import {
  communityResearchJsonSchema,
  createCommunityResearchCollectionPlan,
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
  allowedDomains: ['nowcoder.com'],
  blockedDomains: ['ads.nowcoder.com'],
};

/** 构造测试输入或执行断言的辅助逻辑。 */
function bundle(): CommunityResearchBundle {
  const fingerprint = researchRequestFingerprint(brief);
  return {
    schemaVersion: communityResearchSchemaVersion,
    requestFingerprint: fingerprint,
    generatedAt: '2026-08-30T08:00:00.000Z',
    sources: [
      {
        url: 'https://NOWCODER.com/interview/1#questions',
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
        sourceUrl: 'https://nowcoder.com/interview/1',
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
    expect(prompt).toContain(communityResearchPromptVersion);
    expect(prompt).toContain('不得补写标准答案');
    expect(prompt).toContain('JobHunter 预采集证据包');
    expect(prompt).toContain('不得调用 MCP、Shell、终端、本地文件、通用浏览器');
    expect(prompt).toContain('语义级归并');
    expect(prompt).toContain('SFT 算法如何优化');
    expect(prompt).toContain('不得为了合并而补写答案');
    expect(schema).toMatchObject({ type: 'object' });
  });

  it('prioritizes stable domain-by-role queries and uses generic queries only as budget allows', () => {
    const planBrief: ExperienceResearchBrief = {
      ...brief,
      targetRoles: ['大模型算法', ' 大模型应用开发 ', '大模型算法'],
      companies: [],
      maxSources: 4,
      allowedDomains: ['NOWCODER.COM.', 'nowcoder.com'],
    };

    expect(createCommunityResearchCollectionPlan(planBrief, 3)).toEqual({
      version: 'community-browser-collection@v2',
      queries: [
        'site:nowcoder.com 大模型应用开发 面经 面试 技术问题',
        'site:nowcoder.com 大模型算法 面经 面试 技术问题',
        '大模型应用开发 面经 面试 技术问题',
      ],
      priorityQueryCount: 2,
      relevanceTerms: ['大模型应用开发', '大模型', '大模型算法'],
      maximumSources: 4,
    });

    expect(createCommunityResearchCollectionPlan(planBrief, 2)).toMatchObject({
      queries: [
        'site:nowcoder.com 大模型应用开发 面经 面试 技术问题',
        'site:nowcoder.com 大模型算法 面经 面试 技术问题',
      ],
      priorityQueryCount: 2,
    });
  });

  it('keeps the generic query order and zero priority when no domain is allowed', () => {
    const plan = createCommunityResearchCollectionPlan(
      {
        ...brief,
        targetRoles: ['大模型算法', '大模型应用开发'],
        companies: [],
        allowedDomains: [],
        blockedDomains: [],
        maxSources: 4,
      },
      3,
    );

    expect(plan).toMatchObject({
      version: 'community-browser-collection@v2',
      queries: [
        '大模型应用开发 面经 面试 技术问题',
        '大模型算法 面经 面试 技术问题',
        '大模型应用开发 大模型算法 项目追问 系统设计 面经',
      ],
      priorityQueryCount: 0,
    });
  });

  it('canonicalizes source URLs and removes only exact duplicate questions', () => {
    const normalized = normalizeCommunityResearchBundle({
      value: bundle(),
      brief,
      expectedFingerprint: researchRequestFingerprint(brief),
    });

    expect(normalized.sources[0]?.url).toBe('https://nowcoder.com/interview/1');
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
          sources: [{ ...value.sources[0], url: 'https://outside.acme.dev/interview/1' }],
          experiences: [
            { ...value.experiences[0], sourceUrl: 'https://outside.acme.dev/interview/1' },
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

  it('rejects a bundle made entirely of retrieval-failure placeholders', () => {
    const value = bundle();
    expect(() =>
      normalizeCommunityResearchBundle({
        value: {
          ...value,
          sources: [
            {
              ...value.sources[0],
              title: 'Live web search is unavailable',
            },
          ],
          experiences: [
            {
              ...value.experiences[0],
              questions: [
                {
                  text: 'Unable to retrieve any interview reports or results.',
                  answerExcerpt: null,
                  topics: [],
                  evidenceExcerpt: 'No verifiable sources were found.',
                },
              ],
            },
          ],
          warnings: ['Web browsing is disabled, so this is placeholder data.'],
        },
        brief,
        expectedFingerprint: researchRequestFingerprint(brief),
      }),
    ).toThrow(/no verifiable interview findings/u);
  });

  it('rejects Chinese no-result wording without depending on one exact failure sentence', () => {
    const value = bundle();
    expect(() =>
      normalizeCommunityResearchBundle({
        value: {
          ...value,
          sources: [{ ...value.sources[0], title: '当前环境不支持联网检索' }],
          experiences: [
            {
              ...value.experiences[0],
              questions: [
                {
                  text: '未能检索到可核验的公开面经',
                  answerExcerpt: null,
                  topics: [],
                  evidenceExcerpt: '没有找到有效来源或研究结果',
                },
              ],
            },
          ],
          warnings: ['无可用研究结果。'],
        },
        brief,
        expectedFingerprint: researchRequestFingerprint(brief),
      }),
    ).toThrow(/no verifiable interview findings/u);
  });

  it('does not reject real findings merely because the bundle includes a search warning', () => {
    const value = bundle();
    const normalized = normalizeCommunityResearchBundle({
      value: {
        ...value,
        warnings: ['Unable to retrieve one additional interview source.'],
      },
      brief,
      expectedFingerprint: researchRequestFingerprint(brief),
    });

    expect(normalized.experiences[0]?.questions[0]?.text).toBe('如何 定位 慢查询?');
  });

  it('keeps an explicit interview question about no-result fallback despite a search warning', () => {
    const value = bundle();
    const normalized = normalizeCommunityResearchBundle({
      value: {
        ...value,
        experiences: [
          {
            ...value.experiences[0],
            questions: [
              {
                text: 'RAG 没有找到来源或结果时，如何设计降级策略？',
                answerExcerpt: null,
                topics: ['RAG'],
                evidenceExcerpt: '面试官追问：RAG 没有找到来源或结果时，如何设计降级策略？',
              },
            ],
          },
        ],
        warnings: ['另一个来源未能检索到相关内容。'],
      },
      brief,
      expectedFingerprint: researchRequestFingerprint(brief),
    });

    expect(normalized.experiences[0]?.questions[0]?.text).toContain('如何设计降级策略?');
  });
});
