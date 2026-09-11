import { describe, expect, it } from 'vitest';
import { parseNormalizedJob } from '@jobhunter/domain';
import { requirementStatements } from '../src/requirement-language.js';

/** 最小职位原文夹具，不读取真实数据或参考标签。 */
function extract(description: string, recover = true): string[] {
  const job = parseNormalizedJob({
    companyId: '018f0000-0000-7000-8000-000000000001',
    sourceId: '018f0000-0000-7000-8000-000000000002',
    externalJobId: 'boundary',
    title: '开发实习生',
    department: null,
    jobFamily: '研发',
    locations: [],
    employmentType: '实习',
    experienceText: null,
    educationText: null,
    description,
    detailUrl: 'https://example.com/job',
    applyUrl: 'https://example.com/job',
    publishedAt: null,
  });
  return requirementStatements(job, recover).map((node) => node.text);
}

describe('v3.1 introduction boundary', () => {
  it.each([
    '1、参与Java接口开发',
    '1. 负责Python服务开发',
    '（一）掌握TypeScript',
    '1）2027届本科及以上学历在读',
  ])('recovers a separated numbered requirement: %s', (line) => {
    expect(extract(`团队介绍：团队使用Rust\n持续探索新技术\n\n${line}\n2、熟悉SQL`)).toEqual([
      line,
      '2、熟悉SQL',
    ]);
  });
  it('keeps legacy v3 behavior', () => {
    expect(extract('团队介绍：使用Rust\n\n1、参与Java开发', false)).toEqual([]);
  });
  it('does not resume for blank lines or numbered benefits/introductions', () => {
    expect(extract('福利待遇\n\n1、提供住房补贴\n2、团队使用Java\n\n还有Python技术分享')).toEqual(
      [],
    );
  });
  it('requires a paragraph boundary for implicit recovery', () => {
    expect(extract('团队介绍：平台研发\n1、负责全球Java平台')).toEqual([]);
  });
  it('resumes at explicit headings and stops at later benefits', () => {
    expect(
      extract('公司介绍：使用Rust\n岗位职责：负责Java接口\n福利待遇：Python课程\n\n1、提供补贴'),
    ).toEqual(['岗位职责：负责Java接口']);
  });
});
