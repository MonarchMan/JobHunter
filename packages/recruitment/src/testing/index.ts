import { parseNormalizedJob, type NormalizedJob } from '../domain/index.js';
/** 创建测试用规范职位，并允许覆盖指定字段。 */
export function makeNormalizedJob(overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  return parseNormalizedJob({
    companyId: '018f0000-0000-7000-8000-000000000001',
    sourceId: '018f0000-0000-7000-8000-000000000002',
    externalJobId: 'fixture-job-1',
    title: 'Agent 开发工程师',
    department: '大模型平台',
    jobFamily: '研发',
    locations: ['北京'],
    employmentType: '全职',
    experienceText: null,
    educationText: null,
    description: '负责 Agent 应用开发与评测。',
    detailUrl: 'https://careers.example.com/jobs/fixture-job-1',
    applyUrl: 'https://careers.example.com/apply/fixture-job-1',
    publishedAt: null,
    ...overrides,
  });
}
