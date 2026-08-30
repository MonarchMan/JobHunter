import { describe, expect, it } from 'vitest';
import {
  communityQuestionFingerprint,
  experienceResearchBriefSchema,
  normalizePublicResearchUrl,
  researchRequestFingerprint,
} from '../src/index.js';

const brief = {
  targetRoles: ['后端工程师', '平台工程师'],
  companies: ['示例科技'],
  locations: ['上海'],
  levels: ['高级'],
  stages: ['技术二面'],
  dateFrom: '2025-01-01',
  dateTo: '2026-08-30',
  language: 'zh-CN' as const,
  maxSources: 10,
  maxQuestionsPerSource: 20,
  allowedDomains: ['nowcoder.com', 'interview.nowcoder.com'],
  blockedDomains: ['ads.nowcoder.com'],
};

describe('community interview research', () => {
  it('builds a stable request fingerprint for set-like filters', () => {
    const first = researchRequestFingerprint(brief);
    const reordered = researchRequestFingerprint({
      ...brief,
      targetRoles: [' 平台工程师 ', '后端工程师', '后端工程师'],
      allowedDomains: ['INTERVIEW.NOWCODER.COM.', 'Nowcoder.com'],
    });

    expect(reordered).toBe(first);
    expect(first).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('rejects contradictory date and domain policies', () => {
    expect(() =>
      experienceResearchBriefSchema.parse({
        ...brief,
        dateFrom: '2026-08-31',
        dateTo: '2026-08-30',
      }),
    ).toThrow();
    expect(() =>
      experienceResearchBriefSchema.parse({
        ...brief,
        blockedDomains: ['NOWCODER.COM'],
      }),
    ).toThrow();
    expect(() =>
      experienceResearchBriefSchema.parse({
        ...brief,
        allowedDomains: ['https://example.com/path'],
      }),
    ).toThrow(/domain is invalid/u);
  });

  it('canonicalizes public URLs and rejects local or credential-bearing sources', () => {
    expect(normalizePublicResearchUrl('https://Nowcoder.com/posts/1?q=java#answer')).toBe(
      'https://nowcoder.com/posts/1?q=java',
    );
    expect(() => normalizePublicResearchUrl('http://127.0.0.1/private')).toThrow(
      /publicly addressable/u,
    );
    expect(() => normalizePublicResearchUrl('http://[::1]/private')).toThrow(
      /publicly addressable/u,
    );
    expect(() => normalizePublicResearchUrl('http://[::ffff:127.0.0.1]/private')).toThrow(
      /publicly addressable/u,
    );
    expect(() => normalizePublicResearchUrl('https://token@example.com/private')).toThrow(
      /public HTTP URL/u,
    );
    expect(() => normalizePublicResearchUrl('file:///etc/passwd')).toThrow(/public HTTP URL/u);
  });

  it.each([
    'https://placeholder.invalid/result',
    'https://research.example/result',
    'https://research.test/result',
    'https://example.com/result',
    'https://subdomain.example.org/result',
  ])('rejects special-use or documentation source URL %s', (url) => {
    expect(() => normalizePublicResearchUrl(url)).toThrow(/publicly addressable/u);
  });

  it('deduplicates semantically identical question whitespace', () => {
    expect(communityQuestionFingerprint('如何  定位\n慢查询？')).toBe(
      communityQuestionFingerprint('如何 定位 慢查询?'),
    );
  });
});
