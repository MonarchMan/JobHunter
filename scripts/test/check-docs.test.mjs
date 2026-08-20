import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkDocs } from '../check-docs.mjs';

const roots = [];
const workspaceRoot = path.resolve(import.meta.dirname, '../..');

async function copyDocumentation() {
  const root = await mkdtemp(path.join(tmpdir(), 'jobhunter-docs-'));
  roots.push(root);
  await cp(path.join(workspaceRoot, 'AGENTS.md'), path.join(root, 'AGENTS.md'));
  await cp(path.join(workspaceRoot, 'docs'), path.join(root, 'docs'), { recursive: true });
  await cp(path.join(workspaceRoot, 'specs'), path.join(root, 'specs'), { recursive: true });
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('documentation checker', () => {
  it('accepts the repository documentation', async () => {
    const result = await checkDocs(workspaceRoot);
    expect(result.errors).toEqual([]);
    expect(result.specCount).toBe(13);
  });

  it('finds missing triplet files', async () => {
    const root = await copyDocumentation();
    await rm(path.join(root, 'specs/000-engineering-foundation/tasks.md'));
    const result = await checkDocs(root);
    expect(result.errors).toContain(
      'Missing specification file: specs/000-engineering-foundation/tasks.md',
    );
  });

  it('finds broken relative links', async () => {
    const root = await copyDocumentation();
    await writeFile(path.join(root, 'docs/broken.md'), '[missing](./does-not-exist.md)\n');
    const result = await checkDocs(root);
    expect(result.errors.some((error) => error.includes('Broken link in docs/broken.md'))).toBe(
      true,
    );
  });
});
