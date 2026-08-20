import { rm, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const targets = [path.join(root, 'coverage')];

for (const workspaceRoot of ['apps', 'packages']) {
  const absoluteWorkspaceRoot = path.join(root, workspaceRoot);
  let entries = [];
  try {
    entries = await readdir(absoluteWorkspaceRoot, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      continue;
    }
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    targets.push(path.join(absoluteWorkspaceRoot, entry.name, 'dist'));
    targets.push(path.join(absoluteWorkspaceRoot, entry.name, 'tsconfig.tsbuildinfo'));
  }
}

for (const target of targets) {
  const resolved = path.resolve(target);
  if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Refusing to clean path outside the workspace: ${resolved}`);
  }
  await rm(resolved, { recursive: true, force: true });
}
