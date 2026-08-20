import { parseId, utcInstant } from '@jobhunter/domain';
import { describe, expect, it, vi } from 'vitest';
import {
  CompanyNotFoundError,
  JobExportService,
  JobQueryService,
  type JobListItem,
  type JobQueryFilter,
} from '../src/index.js';

const companyId = parseId('018f0000-0000-7000-8000-000000000001', 'Company');
const job: JobListItem = {
  id: parseId('018f0000-0000-7000-8000-000000000002', 'Job'),
  companyId,
  companyName: '腾讯',
  title: 'Agent 工程师',
  department: null,
  jobFamily: '研发',
  locations: ['北京'],
  status: 'active',
  detailUrl: 'https://example.test/jobs/1',
  applyUrl: 'https://example.test/apply/1',
  publishedAt: null,
  updatedAt: utcInstant(1),
  score: null,
};

describe('JobQueryService', () => {
  it('hides closed jobs by default and resolves company names at the application boundary', () => {
    const query = vi.fn((filter: JobQueryFilter) => {
      void filter;
      return { items: [job], nextCursor: null };
    });
    const service = new JobQueryService({
      jobs: { query, get: () => null },
      companies: {
        findBySelector: (selector) =>
          selector === 'tencent' ? { id: companyId, slug: 'tencent', name: '腾讯' } : null,
      },
    });
    service.list({ companies: ['tencent'] });
    expect(query).toHaveBeenCalledWith({ companyIds: [companyId], statuses: ['active', 'stale'] });
    expect(() => service.list({ companies: ['missing'] })).toThrow(CompanyNotFoundError);
  });

  it('exports every cursor page as deterministic CSV through the file port', async () => {
    const query = vi
      .fn()
      .mockReturnValueOnce({ items: [job], nextCursor: 'next' })
      .mockReturnValueOnce({
        items: [{ ...job, id: parseId('018f0000-0000-7000-8000-000000000003', 'Job') }],
        nextCursor: null,
      });
    const repository = { query, get: () => null };
    const service = new JobQueryService({
      jobs: repository,
      companies: { findBySelector: () => null },
    });
    const writeAtomic = vi.fn((_path: string, content: string) =>
      Promise.resolve({ path: 'jobs.csv', bytes: Buffer.byteLength(content) }),
    );
    const exporter = new JobExportService({
      jobs: repository,
      query: service,
      files: { writeAtomic },
    });

    await expect(
      exporter.export({ path: 'jobs.csv', format: 'csv', bom: true, filter: {} }),
    ).resolves.toMatchObject({ count: 2, path: 'jobs.csv' });
    expect(writeAtomic.mock.calls[0]?.[1]).toMatch(/^\uFEFF"id"/u);
    expect(query).toHaveBeenCalledTimes(2);
  });
});
