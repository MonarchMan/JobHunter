import { readFile, writeFile, access } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import { format, resolveConfig } from 'prettier';
import {
  required,
  validateDiagram,
  escapeHtml as esc,
  edgeGeometry,
  WIDTH,
  HEIGHT,
  NODE_WIDTH,
  NODE_HEIGHT,
} from './model.js';
import type { DiagramView } from './model.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = path.join(root, 'docs/arch/image');

/** 从唯一应用令牌源读取实际值，生成 SVG 时不再维护第二套浅色色板。 */
function token(css: string, name: string): string {
  const value = new RegExp(`--${name}:\\s*([^;]+);`).exec(css)?.[1];
  if (!value) throw new Error(`缺少品牌令牌：${name}`);
  return value.trim();
}

/** 生成只读连线与可导出的完整 SVG；两种输出使用同一几何计算。 */
export function renderSvg(view: DiagramView, tokens: string, full = true): string {
  // 1. 样式直接解析自应用令牌，导出不依赖网页外部 CSS。
  const ink = token(tokens, 'ink');
  const muted = token(tokens, 'muted-ink');
  const surface = token(tokens, 'surface');
  const line = token(tokens, 'line');
  const colors = {
    entry: token(tokens, 'blue'),
    core: token(tokens, 'primary'),
    contract: token(tokens, 'violet'),
    infra: muted,
    human: token(tokens, 'action'),
  };
  const edges = view.edges
    .map((edge) => {
      const geo = edgeGeometry(view, edge);
      return `<g class="edge" data-from="${edge.from}" data-to="${edge.to}"><path d="${geo.path}" fill="none" stroke="${muted}" stroke-width="1.4" ${edge.type ? 'stroke-dasharray="5 5"' : ''} marker-end="url(#arrow-${view.id})"/><text x="${String(geo.x)}" y="${String(geo.y)}" text-anchor="middle" fill="${muted}" font-size="12" stroke="${surface}" stroke-width="7" paint-order="stroke">${esc(edge.label)}</text></g>`;
    })
    .join('');
  // 2. 完整预览使用 SVG 原生图元；交互页面只保留连线，按钮由 HTML 承载。
  const nodes = full
    ? view.nodes
        .map(
          (node) =>
            `<g><rect x="${String(node.x)}" y="${String(node.y)}" width="${String(NODE_WIDTH)}" height="${String(NODE_HEIGHT)}" rx="10" fill="${surface}" stroke="${line}"/><path d="M ${String(node.x + 10)} ${String(node.y + 1)} H ${String(node.x + NODE_WIDTH - 10)}" stroke="${colors[node.kind]}" stroke-width="3"/><text x="${String(node.x + 16)}" y="${String(node.y + 38)}" fill="${ink}" font-size="18" font-weight="600">${esc(node.title)}</text><text x="${String(node.x + 16)}" y="${String(node.y + 65)}" fill="${muted}" font-size="10.5">${esc(node.subtitle)}</text></g>`,
        )
        .join('')
    : '';
  const labels = full
    ? view.lanes
        .map(
          (lane, i) =>
            `<text x="${String(42 + i * 270)}" y="45" fill="${muted}" font-size="14">${esc(lane)}</text>`,
        )
        .join('')
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(WIDTH)} ${String(HEIGHT)}" width="${String(WIDTH)}" height="${String(HEIGHT)}" ${full ? 'role="img"' : 'aria-hidden="true"'} font-family="Microsoft YaHei UI, Noto Sans SC, system-ui, sans-serif"><title>JobHunter · ${esc(view.title)}</title><desc>${esc(view.description)}</desc><defs><marker id="arrow-${view.id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="${muted}"/></marker></defs>${full ? `<rect width="1100" height="640" rx="12" fill="${token(tokens, 'surface-muted')}"/>` : ''}${labels}${edges}${nodes}${full ? `<text x="30" y="615" fill="${muted}" font-size="12">JobHunter · ${esc(view.title)} · ${String(view.nodes.length)} 个节点 / ${String(view.edges.length)} 条关系</text>` : ''}</svg>`;
}

/** 生成离线页面与预览；只读取公开仓库内容，不触碰运行数据。 */
export async function generate(): Promise<Record<string, string>> {
  // 1. 加载并校验唯一图数据，同时验证所引用的仓库路径存在。
  const data = validateDiagram(
    JSON.parse(await readFile(path.join(directory, 'jobhunter.architecture.json'), 'utf8')),
  );
  for (const view of data.views)
    for (const node of view.nodes) await access(path.join(root, node.path));
  const [tokens, css, browser, logo] = await Promise.all([
    readFile(path.join(root, 'apps/web/app/styles/tokens.css'), 'utf8'),
    readFile(new URL('./page.css', import.meta.url), 'utf8'),
    readFile(new URL('./browser.ts', import.meta.url), 'utf8'),
    readFile(path.join(root, 'apps/web/public/assets/brand/jobhunter-logo.png')),
  ]);
  // 2. TypeScript 仅做浏览器代码转译；类型检查由独立 tsconfig 执行。
  const runtime = ts
    .transpileModule(browser, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
    })
    .outputText.replace(/export \{\};?\s*$/, '');
  const outputs: Record<string, string> = {};
  const formatting = await resolveConfig(path.join(directory, 'index.html'));
  for (const view of data.views)
    outputs[`jobhunter-${view.id}.svg`] = await format(renderSvg(view, tokens), {
      ...formatting,
      parser: 'html',
    });
  const templates = data.views
    .map(
      (view) =>
        `<template id="view-${view.id}">${renderSvg(view, tokens, false)}${view.lanes.map((label, i) => `<div class="lane-label" style="left:${String(30 + i * 270)}px">${esc(label)}</div>`).join('')}${view.nodes.map((node) => `<button type="button" class="node" data-id="${node.id}" data-kind="${node.kind}" aria-pressed="false" style="left:${String(node.x)}px;top:${String(node.y)}px" title="${esc(node.subtitle)}"><strong>${esc(node.title)}</strong><small>${esc(node.subtitle)}</small></button>`).join('')}</template><template id="export-${view.id}">${required(outputs[`jobhunter-${view.id}.svg`])}</template>`,
    )
    .join('');
  // 3. 数据嵌入时转义小于号，阻止文案提前关闭 script 标签。
  const json = JSON.stringify(data).replaceAll('<', '\\u003c');
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>JobHunter · 交互架构图</title><style>${tokens}\n${css}</style></head><body>
  <main class="shell"><header class="masthead"><div class="brand"><img src="data:image/png;base64,${logo.toString('base64')}" alt="" width="48" height="48"><div><strong>JobHunter</strong><p>个人求职工作台 · 架构文档</p></div></div><div class="top-actions"><button id="theme" type="button" aria-pressed="false">切换深色</button><button id="export" type="button">导出 SVG</button></div></header>
  <section class="intro" aria-labelledby="page-title"><div><h1 id="page-title">看懂每一次机会，如何抵达。</h1><p id="view-description">${esc(required(data.views[0]).description)}</p></div><span class="tag">Node.js 24 / TypeScript / SQLite</span></section>
  <section class="workspace" aria-label="交互架构图"><div class="toolbar"><div class="switcher" role="group" aria-label="图表视图">${data.views.map((view) => `<button type="button" data-view="${view.id}" aria-pressed="${String(view.id === required(data.views[0]).id)}">${esc(view.title)}</button>`).join('')}</div><div class="tools"><button type="button" id="clear-selection" disabled>取消选择</button></div></div>
  <div class="diagram-layout"><div class="graph-panel"><div id="viewport" class="viewport" tabindex="0" role="region" aria-label="架构画布，可用方向键或滚动条平移"><div id="extent" class="extent"><div id="stage" class="stage"></div></div></div><div class="graph-footer"><p id="status" role="status" aria-live="polite"></p><div class="zoom" role="group" aria-label="画布缩放"><button id="zoom-out" type="button" aria-label="缩小">−</button><output id="zoom-value" aria-label="缩放比例">100%</output><button id="zoom-in" type="button" aria-label="放大">+</button><button id="fit" type="button">适应画布</button></div></div></div>
  <aside class="details" aria-label="节点详情"><p class="eyebrow">节点说明</p><h2 id="detail-title">从一个模块开始</h2><p id="detail-text"></p><code id="detail-path"></code><h3 id="relation-title">读图提示</h3><div id="relations" class="relations"></div></aside></div></section>
  <section class="notes" aria-label="架构原则"><article><h2>共用内核，职责分明</h2><p>Web 与 CLI 提供入口，Worker 承接后台任务。应用编排用例，领域守住规则，基础设施实现端口。</p></article><article><h2>事实优先，判断有据</h2><p>原始职位、修订历史和匹配结果分别保留。模型用于语义增强，确定性数据管道不以模型可用为前提。</p></article><article><h2>机会由你决定</h2><p>简历、任务与记录保存在本地。职位申请由本人在官网完成，面试准备也不替代真实经历与回答。</p></article></section>
  <footer class="bottom"><div class="legend"><span><i style="--legend-color:var(--blue)"></i><span id="legend-entry">入口</span></span><span><i style="--legend-color:var(--primary)"></i><span id="legend-core">应用能力</span></span><span><i style="--legend-color:var(--violet)"></i><span id="legend-contract">核心处理</span></span><span id="legend-infra"><i style="--legend-color:var(--muted-ink)"></i>数据 / 外部服务</span><span><i style="--legend-color:var(--action)"></i>人工行动</span></div><span>点击节点查看关联 · 拖动画布平移 · Esc 清除选择</span></footer>
  <noscript><p>交互需要启用 JavaScript。可查看同目录中的 jobhunter-system.svg 与 jobhunter-flow.svg 静态预览。</p></noscript></main>${templates}<script id="diagram-data" type="application/json">${json}</script><script>${runtime}</script></body></html>`;
  outputs['index.html'] = await format(html, { ...formatting, parser: 'html' });
  return outputs;
}

/** 构建或检查受管理的固定文件；不覆盖其他文档。 */
async function main(): Promise<void> {
  const outputs = await generate();
  for (const [name, content] of Object.entries(outputs)) {
    const target = path.join(directory, name);
    if (process.argv.includes('--check')) {
      if ((await readFile(target, 'utf8')) !== content)
        throw new Error(`${name} 已过期，请运行 pnpm architecture:build`);
    } else await writeFile(target, content, 'utf8');
  }
  console.log(
    `架构文档${process.argv.includes('--check') ? '一致性检查' : '生成'}完成：${Object.keys(outputs).join('、')}`,
  );
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url)
  await main();
