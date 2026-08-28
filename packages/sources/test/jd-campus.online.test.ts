import { parseId } from '@jobhunter/domain';
import { FetchSourceHttpClient } from '@jobhunter/source-core';
import { describe, expect, it } from 'vitest';
import {
  createJdCampusAdapter,
  jdCampusConfigSchema,
  jdCampusListResponseSchema,
} from '../src/index.js';

const online = process.env.JOBHUNTER_ONLINE_SOURCES === '1';
const selected = new Set(
  (process.env.JOBHUNTER_ONLINE_SOURCE ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
);
const entryUrl = 'https://campus.jd.com/#/jobs';
const endpoint = 'https://campus.jd.com/api/wx/position/page?type=present';
const planIdList = ['47', '56', '57', '58'];

describe.skipIf(!online || !selected.has('jd-campus'))('JD campus boundary smoke', () => {
  it('validates the first and last official pages', async () => {
    const http = new FetchSourceHttpClient();
    const signal = AbortSignal.timeout(60_000);
    const pageSize = 100;
    const requestPage = async (
      pageIndex: number,
    ): Promise<ReturnType<typeof jdCampusListResponseSchema.parse>['body']> => {
      const response = await http.request({
        sourceKey: 'jd.campus',
        requestId: `jd-campus-${String(pageIndex)}-${String(Date.now())}`,
        url: endpoint,
        allowedHosts: ['campus.jd.com'],
        signal,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://campus.jd.com',
          referer: entryUrl,
          'x-requested-with': 'XMLHttpRequest',
        },
        body: JSON.stringify({
          pageSize,
          pageIndex,
          parameter: {
            positionName: '',
            planIdList,
            jobDirectionCodeList: [],
            workCityCodeList: [],
            positionDeptList: [],
          },
        }),
        responseType: 'json' as const,
        timeoutMs: 20_000,
      });
      return jdCampusListResponseSchema.parse(response.body).body;
    };

    const first = await requestPage(0);
    expect(first.totalNumber).toBeGreaterThan(0);
    const lastPageIndex = Math.max(0, Math.ceil(first.totalNumber / pageSize) - 1);
    const last = lastPageIndex === 0 ? first : await requestPage(lastPageIndex);
    expect(last.totalNumber).toBe(first.totalNumber);
    expect(last.items).toHaveLength(first.totalNumber - lastPageIndex * pageSize);
    const jobs = lastPageIndex === 0 ? first.items : [...first.items, ...last.items];
    expect(new Set(jobs.map((job) => job.publishId)).size).toBe(jobs.length);
    expect(jobs.every((job) => job.planId && planIdList.includes(String(job.planId)))).toBe(true);

    const adapter = createJdCampusAdapter();
    const config = jdCampusConfigSchema.parse({ pageSize, planIdList });
    for (const raw of jobs) {
      const externalJobId = String(raw.publishId);
      const normalized = await adapter.normalize(
        { discovered: { externalJobId, sourceUrl: entryUrl, raw }, detail: null },
        {
          companyId: parseId('018f0000-0000-7000-8000-000000000109', 'Company'),
          sourceId: parseId('018f0000-0000-7000-8000-000000000232', 'JobSource'),
          config,
        },
      );
      expect(normalized.job.externalJobId).toBe(externalJobId);
      expect(normalized.job.recruitmentCategory).toBe('campus');
      expect(normalized.job.description.length).toBeGreaterThan(0);
    }
  }, 70_000);
});
