import { describe, expect, it } from 'vitest';
import { PlaywrightResumePdfRenderer } from '../src/resume-pdf-renderer.js';

describe('Playwright resume PDF renderer', () => {
  it('renders a print-background A4 PDF containing Chinese resume content', async () => {
    const renderer = new PlaywrightResumePdfRenderer();
    const pdf = await renderer.render(
      '<!doctype html><html lang="zh-CN"><style>@page{size:A4;margin:0}body{background:#eef4ff}h1{break-inside:avoid}</style><h1>候选人简历</h1><p>TypeScript 工程经验</p></html>',
      new AbortController().signal,
    );

    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe('%PDF-');
    expect(pdf.byteLength).toBeGreaterThan(5_000);
  });

  it('does not launch Chromium for an already-cancelled request', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      new PlaywrightResumePdfRenderer().render('<html></html>', controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
