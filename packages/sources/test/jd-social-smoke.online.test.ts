import { parseId } from '@jobhunter/domain';
import { FetchSourceHttpClient } from '@jobhunter/source-core';
import { describe, expect, it } from 'vitest';
import { createJdAdapter, jdConfigSchema, jdListResponseSchema } from '../src/index.js';

const online = process.env.JOBHUNTER_ONLINE_SOURCES === '1';
const selected = new Set(
  (process.env.JOBHUNTER_ONLINE_SOURCE ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
);
const entryUrl = 'https://zhaopin.jd.com/web/job/job_info_list/3';
const headers = {
  'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
  referer: entryUrl,
};

function filters(): Record<string, string> {
  return { workCityJson: '[]', jobTypeJson: '[]', jobSearch: '', depTypeJson: '[]' };
}

describe.skipIf(!online || !selected.has('jd-social'))('JD social boundary smoke', () => {
  it('validates the first and last official pages', async () => {
    const http = new FetchSourceHttpClient();
    const signal = AbortSignal.timeout(120_000);
    const countResponse = await http.request<string>({
      sourceKey: 'jd.social',
      requestId: `jd-social-count-${String(Date.now())}`,
      url: 'https://zhaopin.jd.com/web/job/job_count',
      allowedHosts: ['zhaopin.jd.com'],
      signal,
      method: 'POST',
      headers,
      body: new URLSearchParams(filters()).toString(),
      responseType: 'text',
      timeoutMs: 30_000,
    });
    const total = Number(countResponse.body.trim());
    expect(Number.isSafeInteger(total)).toBe(true);
    expect(total).toBeGreaterThan(0);
    const pageSize = 100;
    const lastPage = Math.ceil(total / pageSize);
    const pages = await Promise.all(
      [1, lastPage].map(async (page) => {
        const response = await http.request<string>({
          sourceKey: 'jd.social',
          requestId: `jd-social-page-${String(page)}-${String(Date.now())}`,
          url: 'https://zhaopin.jd.com/web/job/job_list',
          allowedHosts: ['zhaopin.jd.com'],
          signal,
          method: 'POST',
          headers,
          body: new URLSearchParams({
            pageIndex: String(page),
            pageSize: String(pageSize),
            ...filters(),
          }).toString(),
          responseType: 'text',
          timeoutMs: 30_000,
        });
        return jdListResponseSchema.parse(JSON.parse(response.body) as unknown);
      }),
    );
    expect(pages[0]).toHaveLength(pageSize);
    expect(pages[1]?.length).toBe(total - (lastPage - 1) * pageSize);
    const jobs = pages.flat();
    expect(new Set(jobs.map((job) => job.requirementId)).size).toBe(jobs.length);

    const adapter = createJdAdapter();
    const config = jdConfigSchema.parse({ pageSize });
    for (const raw of jobs) {
      const externalJobId = String(raw.requirementId);
      const normalized = await adapter.normalize(
        { discovered: { externalJobId, sourceUrl: entryUrl, raw }, detail: null },
        {
          companyId: parseId('018f0000-0000-7000-8000-000000000109', 'Company'),
          sourceId: parseId('018f0000-0000-7000-8000-000000000233', 'JobSource'),
          config,
        },
      );
      expect(normalized.job.externalJobId).toBe(externalJobId);
      expect(normalized.job.recruitmentCategory).toBe('social');
      expect(normalized.job.description.length).toBeGreaterThan(0);
    }
  }, 130_000);
});
