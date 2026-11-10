import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { invokeKuaishouRuntime, kuaishouRuntimeReady } from '@jobhunter/recruitment';

// 1、此文件由真实 tsx 子进程加载，避免 Vitest 转译方式掩盖浏览器函数的闭包依赖。
const browser = await chromium.launch({ headless: true });
try {
  for (const campus of [false, true]) {
    const page = await browser.newPage();
    try {
      // 2、只模拟固定官网模块契约；字符串脚本不会受 Node 侧转译影响，也不访问网络。
      await page.addScriptTag({
        content: `
        globalThis.bridgeCount = 0;
        globalThis.webpackJsonp = [];
      `,
      });
      assert.equal(await page.evaluate(kuaishouRuntimeReady), false);
      await page.addScriptTag({
        content: `
        const api = {
          positionSimpleUsingGET: async params => params,
          indexUsingPOST: async params => params
        };
        const requireModule = () => ({ DefaultApi: function () { return api; }, a: api });
        requireModule.m = { './src/services/api/DefaultApi.ts': function () {} };
        globalThis.webpackJsonp.push = function (chunk) {
          globalThis.bridgeCount++;
          chunk[1].jobhunter_kuaishou_bridge(null, null, requireModule);
        };
      `,
      });
      // 3、序列化生产函数到 Chromium，验证注册幂等与两个站点的真实调用边界。
      await page.waitForFunction(kuaishouRuntimeReady, undefined, { timeout: 3_000 });
      assert.equal(await page.evaluate(kuaishouRuntimeReady), true);
      assert.equal(await page.evaluate('globalThis.bridgeCount'), 1);
      const result: unknown = await page.evaluate(invokeKuaishouRuntime, {
        campus,
        operation: 'list' as const,
        pageNum: 1,
        pageSize: 50,
        ...(campus ? { project: 'fixture-project' } : { nature: 'C001' }),
      });
      assert.deepEqual(
        result,
        campus
          ? { pageNum: 1, pageSize: 50, recruitSubProjectCodes: ['fixture-project'] }
          : { pageNum: 1, pageSize: 50, positionNatureCode: 'C001', recruitProject: 'socialr' },
      );
    } finally {
      await page.close();
    }
  }
  console.log('kuaishou-runtime-ok');
} finally {
  await browser.close();
}
