import { expect, test } from '@playwright/test';

test('shows the compact calendar above overview and expands into an accessible dialog', async ({
  page,
}) => {
  await page.goto('/');

  const calendar = page.getByRole('region', { name: '近期日程' });
  const overview = page.getByRole('heading', { name: '工作台概览' });
  await expect(calendar).toBeVisible();
  await expect(calendar.getByText('未来科技')).toBeVisible();
  const calendarBox = await calendar.boundingBox();
  const overviewBox = await overview.boundingBox();
  if (!calendarBox || !overviewBox) throw new Error('Dashboard calendar layout did not render.');
  expect(calendarBox.y).toBeLessThan(overviewBox.y);

  // 1、缩略日期继承组件反馈，不能被全局按钮悬停染黑或产生位移。
  const miniDay = calendar.locator('[class*="miniDay"]').nth(10);
  await miniDay.hover();
  await expect(miniDay).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(miniDay).toHaveCSS('transform', 'none');
  await expect(miniDay).toHaveCSS('box-shadow', 'none');

  await calendar.getByRole('button', { name: '展开招聘日程' }).click();
  const dialog = page.getByRole('dialog', { name: '招聘日程' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: '在线编程' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: '笔试' })).toBeVisible();

  // 详情必须按需读取相邻月份，并允许返回当前月份。
  const monthHeading = dialog.locator('[class*="monthNavigation"] strong');
  const currentMonth = await monthHeading.textContent();
  const nextMonthResponse = page.waitForResponse(
    (response) => response.url().includes('/api/calendar?') && response.status() === 200,
  );
  await dialog.getByRole('button', { name: '下个月' }).click();
  await nextMonthResponse;
  await expect(monthHeading).not.toHaveText(currentMonth ?? '');
  await dialog.getByRole('button', { name: '上个月' }).click();
  await expect(monthHeading).toHaveText(currentMonth ?? '');

  // 截止日期已经过去的笔试仍保留在日历，并与过去的固定安排统一标记为已完成。
  const completedExamDay = dialog.getByRole('button').filter({ hasText: '在线笔试' });
  await expect(completedExamDay).toBeVisible();
  await completedExamDay.click();
  await expect(dialog.getByText('已完成')).toBeVisible();

  // 日期悬停只改变圆形日期标记，不能再把整个日期单元格变成深色背景。
  const selectedDay = dialog.getByRole('button', { pressed: true });
  const hoverDay = dialog.getByRole('button', { name: /项日程$/ }).nth(1);
  const todayCircleColor = await selectedDay
    .locator('span')
    .first()
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  await hoverDay.hover();
  await expect
    .poll(() =>
      hoverDay
        .locator('span')
        .first()
        .evaluate((element) => getComputedStyle(element).backgroundColor),
    )
    .toBe(todayCircleColor);
  await expect
    .poll(() => hoverDay.evaluate((element) => getComputedStyle(element).backgroundColor))
    .not.toBe('rgb(0, 0, 0)');

  // 1、从月历选择带日程的日期；2、详情栏应展示对应公司和岗位。
  const eventDay = dialog.getByRole('button').filter({ hasText: '技术一面' });
  await expect(eventDay).toBeVisible();
  await eventDay.click();
  await expect(dialog.getByText('未来科技 · AI 应用工程师')).toBeVisible();
  await dialog.getByRole('button', { name: '测评' }).click();
  await expect(dialog.getByText('技术一面')).toHaveCount(0);
  await dialog.getByRole('button', { name: '全部' }).click();
  await expect(eventDay).toBeVisible();
  await dialog.getByRole('button', { name: '关闭招聘日程' }).click();
  await expect(dialog).toBeHidden();
});

test('keeps the calendar dialog inside a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: '展开招聘日程' }).click();

  const dialog = page.getByRole('dialog', { name: '招聘日程' });
  const dialogBox = await dialog.boundingBox();
  if (!dialogBox) throw new Error('Calendar dialog did not render.');
  expect(dialogBox.x).toBeGreaterThanOrEqual(0);
  expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(390);
  await expect(dialog.getByRole('button', { name: '上个月' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '下个月' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '全部' })).toBeVisible();
});
