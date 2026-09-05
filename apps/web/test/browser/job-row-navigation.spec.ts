import { expect, test } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

for (const width of [1280, 768, 390]) {
  test(`job row navigation preserves actions and list context at ${String(width)}px`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await context.route('https://careers.tencent.com/**', async (route) => {
      await route.fulfill({ body: 'Fixture official page' });
    });
    const listPath = '/jobs?q=大模型&category=internship&sort=updated_desc&page=1';
    await page.goto(listPath);
    const listUrl = page.url();
    const record =
      width > 900
        ? page
            .getByRole('row')
            .filter({ has: page.getByRole('link', { name: '大模型应用实习生', exact: true }) })
        : page
            .getByRole('article')
            .filter({ has: page.getByRole('link', { name: '大模型应用实习生', exact: true }) });
    await expect(record).toBeVisible();
    // 1、勾选、评分弹层及官网链接都不能触发父行导航。
    await record.getByRole('checkbox').check();
    await expect(record.getByRole('checkbox')).toBeChecked();
    expect(page.url()).toBe(listUrl);
    const scoreButton = record.getByRole('button', { name: '评分', exact: true });
    await scoreButton.scrollIntoViewIfNeeded();
    // 滚动关闭弹层是现有契约，先等布局帧完成再打开，避免测试自身滚动立即关闭弹层。
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              resolve();
            });
          }),
        ),
    );
    await scoreButton.click();
    await expect(page.getByRole('button', { name: /LLM 深度评分/ })).toBeVisible();
    expect(page.url()).toBe(listUrl);
    await page.keyboard.press('Escape');
    await page.route('**/api/jobs/*/match', async (route) => {
      await route.fulfill({ status: 503, json: { error: { message: '测试评分暂不可用' } } });
    });
    await record.getByRole('button', { name: '评分', exact: true }).click();
    // 弹层沿用滚动关闭契约，键盘激活避免测试框架为点击目标滚动页面。
    await page
      .getByRole('button', { name: /LLM 深度评分/ })
      .evaluate((button: HTMLButtonElement) => {
        button.focus({ preventScroll: true });
      });
    await page.keyboard.press('Enter');
    await expect(page.getByText('测试评分暂不可用', { exact: true })).toBeVisible();
    expect(page.url()).toBe(listUrl);
    for (const name of ['大模型应用实习生', '官网投递']) {
      const popupPromise = page.waitForEvent('popup');
      await record.getByRole('link', { name, exact: true }).click();
      const popup = await popupPromise;
      expect(page.url()).toBe(listUrl);
      await popup.close();
    }
    // 2、文本选择和修饰键不会误跳，空白区域的正常点击才激活真实链接。
    const body = width > 900 ? record.locator('td').nth(5) : record.locator('p').first();
    await body.click({ modifiers: ['Control'] });
    expect(page.url()).toBe(listUrl);
    await body.evaluate((element) => {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      selection?.removeAllRanges();
      selection?.addRange(range);
      element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(page.url()).toBe(listUrl);
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    const detailLink = record.getByRole('link', { name: '查看职位详情：大模型应用实习生' });
    const href = await detailLink.getAttribute('href');
    if (!href) throw new Error('Expected internal detail link.');
    expect(new URL(href, listUrl).searchParams.get('profile')).toBeTruthy();
    await page.screenshot({
      path: `../../var/job-row-navigation-${String(width)}.png`,
      fullPage: true,
    });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await body.click();
    await expect(page).toHaveURL(new URL(href, listUrl).href);
    await expect(page.getByRole('heading', { name: '匹配与建议' })).toBeVisible();
    await page.getByRole('link', { name: '← 返回职位列表' }).click();
    await expect(page).toHaveURL(listUrl);
    // 3、原生详情链接支持键盘 Enter，与行点击去往同一站内页面。
    await detailLink.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new URL(href, listUrl).href);
  });
}

test('rejects external job detail return targets', async ({ page }) => {
  await page.goto('/jobs');
  const href = await page.locator('a[data-row-detail-link]').first().getAttribute('href');
  if (!href) throw new Error('Expected detail link.');
  const url = new URL(href, page.url());
  url.searchParams.set('returnTo', 'https://example.com/unsafe');
  await page.goto(url.href);
  await expect(page.getByRole('link', { name: '← 返回职位列表' })).toHaveAttribute(
    'href',
    /^\/jobs(?:\?|$)/,
  );
});
