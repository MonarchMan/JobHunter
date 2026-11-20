import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import {
  associateBrowserFailure,
  clearPlatformResponse,
  discardPlatformResponse,
  platformResponseText,
  withPlatformResponseDiagnostics,
} from '../src/platform/application/response-diagnostics.js';
import { writePlatformResponseLog } from '../src/platform/persistence/response-log.js';

it('失败时完整保存有界响应正文，任务成功时不写日志', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-response-'));
  const directory = path.join(root, 'logs', 'platform-responses');
  const body = '<html>\n失败的原始响应\n</html>';
  const failure = new Error('upstream failure');
  const write = vi.fn(writePlatformResponseLog.bind(null, root, 'fixture-task', 'liepin'));
  try {
    await withPlatformResponseDiagnostics(async () => {
      await discardPlatformResponse(new Response('success'), new AbortController().signal);
    }, write);
    expect(write).not.toHaveBeenCalled();
    await expect(
      withPlatformResponseDiagnostics(async () => {
        await discardPlatformResponse(
          new Response(body, { status: 403, headers: { 'set-cookie': 'private=fixture' } }),
          new AbortController().signal,
        );
        throw failure;
      }, write),
    ).rejects.toBe(failure);
    const [file] = await readdir(directory);
    expect(file).toBeDefined();
    const entry = await readFile(path.join(directory, file ?? ''), 'utf8');
    expect(JSON.parse(entry)).toMatchObject({ taskId: 'fixture-task', status: 403, body });
    expect(entry).not.toContain('private=fixture');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('不误记上一条正文，并保留作用域外浏览器产生的失败正文', async () => {
  const write = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const browserFailure = new Error('browser failure');
  associateBrowserFailure(browserFailure, 200, '{"code":37}');
  const networkFailure = new Error('no response');
  await expect(
    withPlatformResponseDiagnostics(() => {
      platformResponseText(new Response(), [Buffer.from('previous successful body')]);
      clearPlatformResponse();
      return Promise.reject(networkFailure);
    }, write),
  ).rejects.toBe(networkFailure);
  expect(write).not.toHaveBeenCalled();
  await expect(
    withPlatformResponseDiagnostics(() => Promise.reject(browserFailure), write),
  ).rejects.toBe(browserFailure);
  expect(write).toHaveBeenCalledWith({ status: 200, body: '{"code":37}' });
});
