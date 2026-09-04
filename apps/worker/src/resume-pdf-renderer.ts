import { chromium } from 'playwright';
import type { ResumePdfRenderer } from '@jobhunter/application';

/** 使用 Playwright 将简历 HTML 渲染为 PDF。 */
export class PlaywrightResumePdfRenderer implements ResumePdfRenderer {
  /** 初始化页面、写入 HTML、导出 PDF 并在取消时释放资源。 */
  public async render(html: string, signal: AbortSignal): Promise<Uint8Array> {
    if (signal.aborted) throw new DOMException('PDF generation was cancelled.', 'AbortError');
    const browser = await chromium.launch({ headless: true });
    const abort = (): void => {
      void browser.close();
    };
    signal.addEventListener('abort', abort, { once: true });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'load' });
      await page.evaluate('document.fonts.ready');
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
      });
      return new Uint8Array(pdf);
    } finally {
      signal.removeEventListener('abort', abort);
      await browser.close();
    }
  }
}
