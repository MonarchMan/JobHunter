import { expect, test } from '@playwright/test';

/** 新增官网公司的图片使用本地资产，在桌面与窄屏均能解码。 */
test('renders wave-two company logos from local files (UIR-016)', async ({ page }) => {
  const companies = [
    ['快手', 'kuaishou'],
    ['哔哩哔哩', 'bilibili'],
    ['滴滴', 'didi'],
    ['携程', 'ctrip'],
    ['米哈游', 'mihoyo'],
  ] as const;
  // 1、访问实际来源页面；不请求任何外部品牌资源。
  const externalImages: string[] = [];
  page.on('request', (request) => {
    if (
      request.resourceType() === 'image' &&
      !/^(127\.0\.0\.1|localhost)$/.test(new URL(request.url()).hostname)
    )
      externalImages.push(request.url());
  });
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/sources');
    const hrefs = await page
      .getByRole('navigation', { name: '招聘来源分页' })
      .getByRole('link')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? '/sources'));
    const found = new Set<string>();
    // 2、按实际分页查找，不假设新增公司永远位于同一页。
    for (const href of hrefs) {
      await page.goto(href);
      for (const [name, slug] of companies) {
        const card = page
          .locator('[data-company-source-card]')
          .filter({ has: page.getByRole('heading', { name, exact: true }) });
        if ((await card.count()) === 0) continue;
        found.add(name);
        const image = card.locator(`img[src="/assets/company-logos/${slug}.ico"]`);
        await expect(image).toBeVisible();
        await expect(image).toHaveAttribute('alt', '');
        await expect
          .poll(() =>
            image.evaluate(
              (element: HTMLImageElement) => element.complete && element.naturalWidth > 0,
            ),
          )
          .toBe(true);
        const box = await image.boundingBox();
        expect(box?.width).toBeGreaterThan(20);
        expect(box?.width).toBeLessThanOrEqual(32);
      }
    }
    expect([...found].sort()).toEqual(companies.map(([name]) => name).sort());
  }
  expect(externalImages).toEqual([]);
});
