import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { labelAgentKey } from '../../apps/web/app/components/status-labels.ts';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const productionRoots = ['apps', 'packages'].map((directory) =>
  path.join(repositoryRoot, directory),
);
const ignoredDirectories = new Set(['dist', 'node_modules', 'test', 'tests']);

/** 递归收集生产 TypeScript 文件，避免测试夹具中的虚构 Agent 影响登记检查。 */
async function collectTypeScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!entry.name.startsWith('.') && !ignoredDirectories.has(entry.name)) {
        files.push(...(await collectTypeScriptFiles(path.join(directory, entry.name))));
      }
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.ts')) files.push(path.join(directory, entry.name));
  }
  return files;
}

/** 从语法树读取稳定键，避免属性顺序、引号样式和注释导致漏检。 */
function findAgentKeys(file, source) {
  const keys = new Set();
  const syntax = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  /** 先收集提示词的键，再检查 Agent 定义必须使用显式键或提示词元数据。 */
  function visit(node) {
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(syntax) === 'agentKey' &&
      ts.isStringLiteralLike(node.initializer)
    ) {
      keys.add(node.initializer.text);
    }
    if (ts.isCallExpression(node) && node.expression.getText(syntax) === 'defineAgent') {
      const definition = node.arguments[0];
      const key =
        definition && ts.isObjectLiteralExpression(definition)
          ? definition.properties.find((property) => property.name?.getText(syntax) === 'key')
          : undefined;
      if (!key || !ts.isPropertyAssignment(key)) {
        throw new Error(`${file}：Agent 定义必须显式声明 key，以便校验中文名称。`);
      }
      if (ts.isStringLiteralLike(key.initializer)) {
        keys.add(key.initializer.text);
      } else if (
        !ts.isPropertyAccessExpression(key.initializer) ||
        key.initializer.name.text !== 'agentKey'
      ) {
        throw new Error(`${file}：Agent key 必须使用字符串或提示词的 agentKey。`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(syntax);
  return keys;
}

describe('Agent 中文名称登记', () => {
  it('要求每个生产 Agent 类型具有独立中文名称', async () => {
    // 1、扫描定义与提示词，覆盖直接键和通过 PromptDescriptor 间接传入的键。
    const files = (await Promise.all(productionRoots.map(collectTypeScriptFiles))).flat();
    const keys = new Set();
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      for (const key of findAgentKeys(file, source)) keys.add(key);
    }

    // 2、通用占位只用于防御历史脏数据，不能替代新增 Agent 的显式名称。
    const missing = [...keys].filter((key) => labelAgentKey(key) === '未登记的 Agent 类型').sort();
    expect(missing, `以下 Agent 类型缺少中文名称：${missing.join(', ')}`).toEqual([]);
    expect(keys.size).toBeGreaterThan(0);
    for (const key of keys) expect(labelAgentKey(key)).toMatch(/[\u3400-\u9FFF]/);
  });
});
