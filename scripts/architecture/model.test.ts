import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import type { Diagram } from './model.js';
import { required, validateDiagram, escapeHtml } from './model.js';
import { generate } from './build.js';

/** 每个用例独立载入数据，防止错误数据变异污染后续测试。 */
async function fixture(): Promise<Diagram> {
  return validateDiagram(
    JSON.parse(
      await readFile(
        new URL('../../docs/arch/image/jobhunter.architecture.json', import.meta.url),
        'utf8',
      ),
    ),
  );
}

await test('拒绝数组根、重复节点、悬空关系和越界坐标', async () => {
  assert.throws(() => validateDiagram([]));
  const repeated = await fixture();
  required(repeated.views[0]).nodes.push(required(required(repeated.views[0]).nodes[0]));
  assert.throws(() => validateDiagram(repeated), /重复/);
  const dangling = await fixture();
  required(required(dangling.views[0]).edges[0]).to = 'missing';
  assert.throws(() => validateDiagram(dangling), /关系引用/);
  const outside = await fixture();
  required(required(outside.views[0]).nodes[0]).x = Number.NaN;
  assert.throws(() => validateDiagram(outside), /画布/);
});

await test('路径不可跳出公开仓库目录，文案转义为纯文本', async () => {
  const data = await fixture();
  required(required(data.views[0]).nodes[0]).path = 'docs/../../.env';
  assert.throws(() => validateDiagram(data), /路径/);
  assert.equal(escapeHtml('<script>"&'), '&lt;script&gt;&quot;&amp;');
});

await test('系统架构以实际处理模块解释协作，并明确不是代码导入关系', async () => {
  const data = await fixture();
  const system = required(data.views.find((view) => view.id === 'system'));
  assert.equal(system.title, '系统架构图');
  assert.match(system.description, /不表示代码导入/);
  for (const id of ['sync-engine', 'resume-matching', 'ai-engine'])
    assert.ok(system.edges.some((edge) => edge.from === 'application' && edge.to === id));
  assert.ok(!system.nodes.some((node) => ['domain', 'ports', 'contracts'].includes(node.id)));
});

await test('经历来自个人资料，再建立面试档案；经历分支位于最上行', async () => {
  const data = await fixture();
  const flow = required(data.views.find((view) => view.id === 'flow'));
  const lineage = [
    ['resume-input', 'profile'],
    ['profile', 'resume-projects'],
    ['resume-projects', 'interview'],
    ['interview', 'practice'],
  ];
  for (const [from, to] of lineage)
    assert.ok(flow.edges.some((edge) => edge.from === from && edge.to === to));
  assert.ok(!flow.nodes.some((node) => node.id === 'materials'));
  const experiences = required(flow.nodes.find((node) => node.id === 'resume-projects'));
  assert.equal(experiences.title, '项目经历/工作经历');
  assert.equal(experiences.y, Math.min(...flow.nodes.map((node) => node.y)));
});

await test('生成产物可重复、无需外部脚本或图片且与提交文件一致', async () => {
  const output = await generate();
  assert.ok(
    !/<script[^>]+src=|<link[^>]+href=|<img[^>]+src="https?:/i.test(required(output['index.html'])),
  );
  for (const [name, content] of Object.entries(output)) {
    assert.equal(
      await readFile(new URL(`../../docs/arch/image/${name}`, import.meta.url), 'utf8'),
      content,
      name,
    );
  }
});
