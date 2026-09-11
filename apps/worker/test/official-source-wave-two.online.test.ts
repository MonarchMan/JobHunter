import { chromium, type BrowserContext, type Response } from 'playwright';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { resolveBrowserExecutablePath } from '../src/browser-source.js';

const enabled = process.env.JOBHUNTER_ONLINE_SOURCES === '1';
const selected = new Set((process.env.JOBHUNTER_ONLINE_SOURCE ?? '').split(','));
const pageSize = 10;

/** 研究 smoke 只保留公开职位字段，未知字段不会进入输出或证据。 */
const kuaishouJob = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  description: z.string().min(1),
  positionDemand: z.string().min(1),
  positionNatureCode: z.literal('C001'),
  recruitProjectCode: z.literal('socialr'),
  workLocationsCode: z.array(z.string()).min(1),
});
/** B 站社招列表与详情共享的必要字段，职责正文必须非空。 */
const bilibiliJob = z.object({
  id: z.number().int().positive(),
  positionName: z.string().min(1),
  positionDescription: z.string().min(1),
  positionTypeName: z.literal('全职'),
  recruitType: z.literal(0),
  workLocation: z.string().min(1),
});
const kuaishouList = z.object({
  code: z.literal(0),
  result: z.object({
    total: z.number().int().positive(),
    pageNum: z.number().int().positive(),
    pageSize: z.literal(pageSize),
    list: z.array(kuaishouJob),
  }),
});
const bilibiliList = z.object({
  code: z.literal(0),
  data: z.object({
    total: z.number().int().positive(),
    pages: z.number().int().positive(),
    list: z.array(bilibiliJob),
  }),
});

/** 同时观察当前页和官网新开的详情页，只匹配目标职位响应。 */
function waitForDetail(context: BrowserContext, id: number): Promise<Response> {
  return context.waitForEvent('response', {
    timeout: 30_000,
    predicate: async (response) => {
      // 1、限定公开职位接口，排除鉴权、简历、字典和埋点请求。
      const path = new URL(response.url()).pathname;
      if (!/\/api\/(?:v1\/open\/|srs\/position\/detail\/)/.test(path)) return false;
      if (!(response.headers()['content-type'] ?? '').includes('json')) return false;
      // 2、目标 ID 比接口名字更可靠，避免误认字典和列表响应为详情。
      const body: unknown = await response.json().catch(() => null);
      return (
        z.object({ code: z.literal(0), result: z.object({ id: z.literal(id) }) }).safeParse(body)
          .success ||
        z.object({ code: z.literal(0), data: z.object({ id: z.literal(id) }) }).safeParse(body)
          .success
      );
    },
  });
}

describe('wave-two official protocol research (SWT-002, SWT-003, SWT-004)', () => {
  it.skipIf(!enabled || !selected.has('kuaishou'))(
    'samples Kuaishou social first/last and one detail',
    async () => {
      // 1、使用临时匿名浏览器，职位数据只来自官网正常请求。
      const browser = await chromium.launch({
        headless: true,
        executablePath: resolveBrowserExecutablePath(),
      });
      try {
        const page = await browser.newPage();
        const listPath = '/recruit/e/api/v1/open/positions/simple';
        const [firstResponse] = await Promise.all([
          page.waitForResponse((r) => new URL(r.url()).pathname === listPath, { timeout: 30_000 }),
          page.goto('https://zhaopin.kuaishou.cn/#/official/social/', {
            waitUntil: 'domcontentloaded',
          }),
        ]);
        expect(firstResponse.status()).toBe(200);
        const first = kuaishouList.parse(await firstResponse.json()).result;
        expect(first.pageNum).toBe(1);
        expect(first.list).toHaveLength(Math.min(first.total, pageSize));
        // 2、由总数计算末页；官网点击产生新请求，不重放签名或遍历中间页。
        const lastPage = Math.ceil(first.total / pageSize);
        const last =
          lastPage === 1
            ? first
            : await (async () => {
                const [response] = await Promise.all([
                  page.waitForResponse(
                    (r) =>
                      new URL(r.url()).pathname === listPath &&
                      new URL(r.url()).searchParams.get('pageNum') === String(lastPage),
                    { timeout: 30_000 },
                  ),
                  page.locator(`li.ant-pagination-item[title="${String(lastPage)}"]`).click(),
                ]);
                expect(response.status()).toBe(200);
                return kuaishouList.parse(await response.json()).result;
              })();
        expect(last.pageNum).toBe(lastPage);
        expect(last.total).toBe(first.total);
        expect(last.list).toHaveLength(first.total - (lastPage - 1) * pageSize);
        const samples = lastPage === 1 ? first.list : [...first.list, ...last.list];
        expect(new Set(samples.map((job) => job.id)).size).toBe(samples.length);
        // 3、从当前末页进入详情，核对 ID、名称、职责、要求与官方岗位深链。
        const job = last.list[0];
        if (!job) throw new Error('Expected a non-empty last page.');
        const [detailResponse] = await Promise.all([
          waitForDetail(page.context(), job.id),
          page.getByText(job.name, { exact: true }).first().click(),
        ]);
        expect(detailResponse.status()).toBe(200);
        const detail = z
          .object({ code: z.literal(0), result: kuaishouJob })
          .parse(await detailResponse.json()).result;
        expect(detail.id).toBe(job.id);
        expect(detail.name).toBe(job.name);
        expect(detailResponse.frame().url()).toBe(
          `https://zhaopin.kuaishou.cn/#/official/social/job-info/${String(job.id)}`,
        );
        console.info(
          JSON.stringify({
            company: 'kuaishou',
            channel: 'social',
            at: new Date().toISOString(),
            total: first.total,
            pages: [...new Set([1, lastPage])],
            lengths: [first.list.length, last.list.length],
            samples: samples.length,
            detailId: job.id,
            coverage: 'partial',
            reason: 'sampled_pages',
          }),
        );
      } finally {
        await browser.close();
      }
    },
    90_000,
  );

  it.skipIf(!enabled || !selected.has('bilibili'))(
    'samples Bilibili social first/last and one detail',
    async () => {
      // 1、由官网建立匿名会话，仅在当前浏览器内使用请求头，不记录凭据。
      const browser = await chromium.launch({
        headless: true,
        executablePath: resolveBrowserExecutablePath(),
      });
      try {
        const page = await browser.newPage();
        const listPath = '/api/srs/position/positionList';
        const [firstResponse] = await Promise.all([
          page.waitForResponse((r) => new URL(r.url()).pathname === listPath, { timeout: 30_000 }),
          page.goto('https://jobs.bilibili.com/social/positions', {
            waitUntil: 'domcontentloaded',
          }),
        ]);
        expect(firstResponse.status()).toBe(200);
        const first = bilibiliList.parse(await firstResponse.json()).data;
        const template = z
          .object({ pageNum: z.literal(1), pageSize: z.literal(pageSize) })
          .loose()
          .parse(firstResponse.request().postDataJSON());
        expect(first.list).toHaveLength(Math.min(first.total, pageSize));
        const headers = Object.fromEntries(
          Object.entries(await firstResponse.request().allHeaders()).filter(
            ([key]) =>
              !key.startsWith(':') &&
              !['host', 'cookie', 'content-length', 'connection', 'accept-encoding'].includes(key),
          ),
        );
        // 2、末页的 pages/size 按实际返回条数计算，不能用于确定请求页数。
        const lastPage = Math.ceil(first.total / pageSize);
        const last =
          lastPage === 1
            ? first
            : await (async () => {
                const result = await page.evaluate(
                  async ({ url, headers, body }) => {
                    const response = await fetch(url, {
                      method: 'POST',
                      headers,
                      body: JSON.stringify(body),
                    });
                    return { status: response.status, body: (await response.json()) as unknown };
                  },
                  { url: firstResponse.url(), headers, body: { ...template, pageNum: lastPage } },
                );
                expect(result.status).toBe(200);
                return bilibiliList.parse(result.body).data;
              })();
        expect(last.total).toBe(first.total);
        expect(last.list).toHaveLength(first.total - (lastPage - 1) * pageSize);
        const samples = lastPage === 1 ? first.list : [...first.list, ...last.list];
        expect(new Set(samples.map((job) => job.id)).size).toBe(samples.length);
        // 3、官网打开详情页后核对身份、正文与岗位深链。
        const job = first.list[0];
        if (!job) throw new Error('Expected a non-empty first page.');
        const [detailResponse] = await Promise.all([
          waitForDetail(page.context(), job.id),
          page.getByText('查看职位', { exact: true }).first().click(),
        ]);
        expect(detailResponse.status()).toBe(200);
        const detail = z
          .object({ code: z.literal(0), data: bilibiliJob })
          .parse(await detailResponse.json()).data;
        expect(detail.id).toBe(job.id);
        expect(detail.positionName).toBe(job.positionName);
        expect(detail.positionDescription).toContain('工作职责');
        expect(detail.positionDescription).toContain('工作要求');
        expect(detailResponse.frame().url()).toBe(
          `https://jobs.bilibili.com/social/positions/${String(job.id)}`,
        );
        console.info(
          JSON.stringify({
            company: 'bilibili',
            channel: 'social',
            at: new Date().toISOString(),
            total: first.total,
            pages: [...new Set([1, lastPage])],
            lengths: [first.list.length, last.list.length],
            reportedPages: [first.pages, last.pages],
            samples: samples.length,
            detailId: job.id,
            coverage: 'partial',
            reason: 'sampled_pages',
          }),
        );
      } finally {
        await browser.close();
      }
    },
    90_000,
  );
});
