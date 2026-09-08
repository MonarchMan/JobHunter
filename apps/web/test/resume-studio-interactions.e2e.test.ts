import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, webkit, expect as browserExpect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { getResumeTemplate, profileToResumeContent } from '@jobhunter/resume-template';
import { makeCandidateProfile } from '@jobhunter/testkit';
import { it, expect } from 'vitest';

/** 在 about:blank 上测试真实 React + iframe 交互，不启动 Web 服务或读取用户数据。 */
it.each([
  ['chromium', 'technical-blueprint'],
  ['chromium', 'clean-single-column'],
  ['webkit', 'technical-blueprint'],
  ['webkit', 'clean-single-column'],
] as const)(
  'edits blocks, manages sections and exits lists in %s / %s',
  async (engine, templateKey) => {
    const directory = await mkdtemp(join(tmpdir(), 'jobhunter-studio-component-'));
    const browser = await (engine === 'webkit' ? webkit : chromium).launch({ headless: true });
    try {
      const bundle = join(directory, 'studio.js');
      execFileSync(
        'pnpm',
        [
          'exec',
          'esbuild',
          'apps/web/test/fixtures/resume-studio-harness.tsx',
          '--bundle',
          '--format=iife',
          '--global-name=studioHarness',
          '--platform=browser',
          '--jsx=automatic',
          `--outfile=${bundle}`,
        ],
        { cwd: resolve('.'), stdio: 'pipe' },
      );
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      page.setDefaultTimeout(5_000);
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.setContent(
        '<html lang="zh-CN"><head><title>简历制作组件测试</title></head><body></body></html>',
      );
      await page.addStyleTag({ content: await readFile(join(directory, 'studio.css'), 'utf8') });
      await page.addScriptTag({ content: await readFile(bundle, 'utf8') });
      const initial = {
        draft: {
          id: 'test-draft',
          profileId: 'test-profile',
          templateKey,
          templateVersion: 1,
          sourceProfileVersionId: 'source',
          revision: 0,
          avatarFileId: null,
          avatarFileVersion: null,
          createdAt: 1,
          updatedAt: 1,
          content: profileToResumeContent(
            makeCandidateProfile({
              basicInfo: {
                name: '测试候选人',
                phone: null,
                email: null,
                location: null,
                website: null,
              },
              projects: [
                {
                  name: '测试项目',
                  role: '开发',
                  startDate: null,
                  endDate: null,
                  highlights: ['第一条职责', '第二条职责'],
                  evidence: [],
                },
              ],
              certificates: [],
              languages: [],
              professionalSkills: '熟悉系统设计。\n掌握性能优化。',
            }),
          ),
        },
        template: getResumeTemplate(templateKey),
        currentProfileVersionId: 'source',
        stale: false,
        avatarDataUrl: null,
      };
      await page.evaluate((data) => {
        (
          window as unknown as { studioHarness: { mount: (initial: unknown) => void } }
        ).studioHarness.mount(data);
      }, initial);
      const canvas = page.locator('iframe').contentFrame();
      await browserExpect(canvas.locator('[data-section-id="projects"]')).toBeVisible();
      // 悬浮工具必须高于后一个仍聚焦的文本块，尤其是紧邻的标题／角色行。
      await canvas.locator('[data-field="projects.0.role"]').click();
      const header = canvas.locator('[data-block-id="projects.0.header"]');
      await header.hover();
      await header.getByRole('button', { name: '在本块后新增 1 栏' }).click();
      const headerRow = canvas.locator('[data-section-id="projects"] .text-row');
      await browserExpect(headerRow).toHaveCount(1);
      await headerRow.hover();
      await headerRow.getByRole('button', { name: '删除本块' }).click();
      await browserExpect(headerRow).toHaveCount(0);
      // 0、真实点击空白行内字段，不能用 fill／focus／Tab 绕过鼠标命中问题。
      const endDate = canvas.locator('[data-field="projects.0.endDate"]');
      await endDate.click();
      await browserExpect(endDate).toBeFocused();
      await page.keyboard.type('2026.09');
      await browserExpect(endDate).toHaveText('2026.09');
      await page.getByRole('button', { name: '新增语言能力', exact: true }).click();
      const language = canvas.locator('[data-field="languages.0.proficiency"]');
      await language.click();
      await browserExpect(language).toBeFocused();
      await page.keyboard.type('Fluent');
      await browserExpect(language).toHaveText('Fluent');
      const languageName = canvas.locator('[data-field="languages.0.name"]');
      await languageName.click();
      await browserExpect(languageName).toBeFocused();
      await page.keyboard.type('English');
      await browserExpect(languageName).toHaveText('English');
      const languageBlock = canvas.locator('[data-block-id="languages.0.text"]');
      for (const columns of [1, 2, 3]) {
        await languageBlock.hover();
        await languageBlock
          .getByRole('button', { name: `在本块后新增 ${String(columns)} 栏` })
          .click();
        const inserted = canvas.locator('[data-section-id="languages"] .text-row');
        await browserExpect(inserted).toHaveCount(1);
        await browserExpect(inserted.locator('.text-cell')).toHaveCount(columns);
        await inserted.hover();
        await inserted.getByRole('button', { name: '删除本块' }).click();
        await browserExpect(inserted).toHaveCount(0);
      }
      // 1、重复点击图标和键盘 Enter 都能新增，随后仅删除当前块。
      const project = canvas.locator('[data-block-id="projects.0.description"]');
      await project.hover();
      await project.getByRole('button', { name: '在本块后新增 2 栏' }).click();
      await browserExpect(canvas.locator('[data-section-id="projects"] .text-row')).toHaveCount(1);
      let row = canvas.locator('[data-section-id="projects"] .text-row').last();
      await row.getByRole('button', { name: '在本块后新增 3 栏' }).focus();
      await row.getByRole('button', { name: '在本块后新增 3 栏' }).press('Enter');
      await browserExpect(canvas.locator('[data-section-id="projects"] .text-row')).toHaveCount(2);
      row = canvas.locator('[data-section-id="projects"] .text-row').last();
      await row.hover();
      await row.getByRole('button', { name: '删除本块' }).click();
      await browserExpect(canvas.locator('[data-section-id="projects"] .text-row')).toHaveCount(1);
      // 2、列表行首退格保留文本；继续回车是普通段落，其他列表项不变。
      const description = project.locator('[data-description]');
      await description.locator('li').first().click();
      await description
        .locator('li')
        .first()
        .evaluate((item) => item.ownerDocument.getSelection()?.collapse(item, 0));
      await description.press('Backspace');
      await browserExpect(description.locator('li')).toHaveCount(1);
      await description.press('End');
      await description.press('Enter');
      await description.pressSequentially('普通段落');
      await browserExpect(description.locator('li')).toHaveCount(1);
      await browserExpect(description).toContainText('第一条职责');
      const skills = canvas.locator('[data-field="professionalSkillBlocks"]');
      await page.getByRole('button', { name: '专业技能', exact: true }).click();
      await skills.locator('li').first().click();
      // Home 在 macOS 可能只滚动；测试明确将光标放在行首，再发送真实退格键。
      await skills
        .locator('li')
        .first()
        .evaluate((item) => item.ownerDocument.getSelection()?.collapse(item, 0));
      await skills.press('Backspace');
      await skills.press('End');
      await skills.press('Enter');
      await skills.pressSequentially('普通技能说明');
      await browserExpect(skills.locator('li')).toHaveCount(1);
      // 3、空章节不占正文；添加后即使尚未填写也可以保存、恢复和删除。
      await browserExpect(canvas.locator('[data-section-id="certificates"]')).toHaveCount(0);
      await page.getByRole('button', { name: '新增证书', exact: true }).click();
      await browserExpect(
        page.getByRole('button', { name: '新增证书', exact: true }),
      ).toBeDisabled();
      await browserExpect(canvas.locator('[data-section-id="certificates"]')).toBeVisible();
      await browserExpect(page.locator('[data-resume-save-state]')).toContainText('已保存');
      await page.evaluate(() => {
        const harness = (
          window as unknown as {
            studioHarness: { saved: () => unknown; mount: (data: unknown) => void };
          }
        ).studioHarness;
        harness.mount(harness.saved());
      });
      await browserExpect(
        page.getByRole('button', { name: '新增证书', exact: true }),
      ).toBeDisabled();
      await browserExpect(skills).toContainText('普通技能说明');
      await browserExpect(languageName).toHaveText('English');
      await browserExpect(language).toHaveText('Fluent');
      await browserExpect(endDate).toHaveText('2026.09');
      await browserExpect(skills.locator('li')).toHaveCount(1);
      await browserExpect(description).toContainText('普通段落');
      await browserExpect(description.locator('li')).toHaveCount(1);
      await page.getByRole('button', { name: '删除证书', exact: true }).click();
      await browserExpect(canvas.locator('[data-section-id="certificates"]')).toHaveCount(0);
      await page.getByRole('button', { name: '删除项目经历', exact: true }).click();
      await browserExpect(page.getByRole('dialog', { name: '删除项目经历？' })).toBeVisible();
      await page.getByRole('button', { name: '保留章节' }).click();
      await browserExpect(canvas.locator('[data-section-id="projects"]')).toHaveCount(1);
      await page.getByRole('button', { name: '删除项目经历', exact: true }).click();
      await page.getByRole('button', { name: '删除章节', exact: true }).click();
      await browserExpect(canvas.locator('[data-section-id="projects"]')).toHaveCount(0);
      await browserExpect(
        page.getByRole('button', { name: '新增项目经历', exact: true }),
      ).toBeEnabled();
      await page.getByRole('button', { name: '新增项目经历', exact: true }).click();
      await browserExpect(canvas.locator('[data-section-id="projects"]')).not.toContainText(
        '测试项目',
      );
      await mkdir('var/qa', { recursive: true });
      await page.screenshot({
        path: `var/qa/resume-studio-${engine}-${templateKey}-desktop.png`,
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({
        path: `var/qa/resume-studio-${engine}-${templateKey}-mobile.png`,
        fullPage: true,
      });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      expect(errors).toEqual([]);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      // 4、兼容回调不等于允许画布脚本：在隔离测试页主动注入探针，验证 CSP。
      const probes = await page.locator('iframe').evaluate(async (frame) => {
        const doc = (frame as HTMLIFrameElement).contentDocument;
        if (!doc) throw new Error('测试画布尚未载入');
        const violations: string[] = [];
        doc.addEventListener('securitypolicyviolation', (event) => {
          violations.push(event.effectiveDirective);
        });
        const script = doc.createElement('script');
        script.textContent = 'document.documentElement.dataset.executed = "yes"';
        doc.body.append(script);
        const external = doc.createElement('script');
        external.src = 'https://resume-security-test.invalid/probe.js';
        doc.body.append(external);
        const picture = doc.createElement('img');
        picture.setAttribute('onerror', 'document.documentElement.dataset.executed = "yes"');
        picture.src = 'https://resume-security-test.invalid/probe.png';
        doc.body.append(picture);
        // CSP 报告异步派发；探针只在虚构的 about:blank 组件测试中执行。
        await new Promise((resolve) => setTimeout(resolve, 100));
        return { executed: doc.documentElement.dataset.executed, violations };
      });
      expect(probes.executed).toBeUndefined();
      expect(probes.violations.some((directive) => directive.startsWith('script-src'))).toBe(true);
      expect(probes.violations).toContain('img-src');
    } finally {
      await browser.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
  60_000,
);
