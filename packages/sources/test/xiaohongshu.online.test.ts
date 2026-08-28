import { parseId } from '@jobhunter/domain';
import { FetchSourceHttpClient } from '@jobhunter/source-core';
import { describe, expect, it } from 'vitest';
import {
  createXiaohongshuSocialAdapter,
  scriptedConfigSchema,
  xiaohongshuListResponseSchema,
} from '../src/index.js';

const online = process.env.JOBHUNTER_ONLINE_SOURCES === '1';
const selected = new Set(
  (process.env.JOBHUNTER_ONLINE_SOURCE ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
);
const entryUrl = 'https://job.xiaohongshu.com/social/position';
const endpoint = 'https://job.xiaohongshu.com/websiterecruit/position/pageQueryPosition';

describe.skipIf(!online || !selected.has('xiaohongshu-social'))(
  'Xiaohongshu social boundary smoke',
  () => {
    it('validates the first and last official pages', async () => {
      const http = new FetchSourceHttpClient();
      const signal = AbortSignal.timeout(60_000);
      const pageSize = 100;
      const requestPage = async (
        pageNum: number,
      ): Promise<ReturnType<typeof xiaohongshuListResponseSchema.parse>['data']> => {
        const response = await http.request({
          sourceKey: 'xiaohongshu.social',
          requestId: `xiaohongshu-social-${String(pageNum)}-${String(Date.now())}`,
          url: endpoint,
          allowedHosts: ['job.xiaohongshu.com'],
          signal,
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: 'https://job.xiaohongshu.com',
            referer: entryUrl,
          },
          body: JSON.stringify({ recruitType: 'social', positionName: '', pageNum, pageSize }),
          responseType: 'json' as const,
          timeoutMs: 20_000,
        });
        return xiaohongshuListResponseSchema.parse(response.body).data;
      };

      const first = await requestPage(1);
      expect(first.total).toBeGreaterThan(0);
      expect(first.list).toHaveLength(pageSize);
      const last = first.totalPage === 1 ? first : await requestPage(first.totalPage);
      expect(last.total).toBe(first.total);
      expect(last.list).toHaveLength(first.total - (first.totalPage - 1) * pageSize);
      const jobs = first.totalPage === 1 ? first.list : [...first.list, ...last.list];
      expect(new Set(jobs.map((job) => String(job.positionId))).size).toBe(jobs.length);

      const adapter = createXiaohongshuSocialAdapter();
      const config = scriptedConfigSchema.parse({ pageSize });
      for (const raw of jobs) {
        const externalJobId = String(raw.positionId);
        const normalized = await adapter.normalize(
          { discovered: { externalJobId, sourceUrl: entryUrl, raw }, detail: null },
          {
            companyId: parseId('018f0000-0000-7000-8000-000000000108', 'Company'),
            sourceId: parseId('018f0000-0000-7000-8000-000000000231', 'JobSource'),
            config,
          },
        );
        expect(normalized.job.externalJobId).toBe(externalJobId);
        expect(normalized.job.recruitmentCategory).toBe('social');
        expect(normalized.job.description.length).toBeGreaterThan(0);
      }
    }, 70_000);
  },
);
