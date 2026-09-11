import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';

/** 仅托管公开架构产物的本机预览器；白名单避免暴露仓库或用户数据。 */
const routes = new Map<string, readonly [string, string]>([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  [
    '/jobhunter.architecture.json',
    ['jobhunter.architecture.json', 'application/json; charset=utf-8'],
  ],
  ['/jobhunter-system.svg', ['jobhunter-system.svg', 'image/svg+xml']],
  ['/jobhunter-flow.svg', ['jobhunter-flow.svg', 'image/svg+xml']],
]);
/** 处理单个本地读取请求，读取失败以明确的构建提示返回。 */
async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  // 1. 只接受读取白名单产物，路径不参与文件系统拼接。
  const route = routes.get((request.url ?? '').split('?')[0] ?? '');
  if (!route || !['GET', 'HEAD'].includes(request.method ?? '')) {
    response.writeHead(404);
    response.end('Not found');
    return;
  }
  try {
    // 2. 每次读取生成文件，重建后刷新即可查看最新文档。
    const bytes = await readFile(new URL(`../../docs/arch/image/${route[0]}`, import.meta.url));
    response.writeHead(200, {
      'Content-Type': route[1],
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(request.method === 'HEAD' ? undefined : bytes);
  } catch {
    response.writeHead(500);
    response.end('请先运行 pnpm architecture:build');
  }
}
const server = createServer((request, response) => {
  void handle(request, response);
});
server.on('error', (error) => {
  console.error(`架构预览启动失败：${error.message}`);
  process.exitCode = 1;
});
server.listen(4321, '127.0.0.1', () => {
  console.log('架构图预览：http://127.0.0.1:4321/');
});
