import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const workspaceRoot = path.resolve(import.meta.dirname, '../..');
const packageJson = JSON.parse(await readFile(path.join(workspaceRoot, 'package.json'), 'utf8'));

const shellSyntax = /(?:&&|\|\||[;&|<>`\r\n])/;

describe('root command portability', () => {
  it('keeps root scripts free of shell-specific command chaining', () => {
    for (const [name, command] of Object.entries(packageJson.scripts)) {
      expect(command, `root script ${name}`).not.toMatch(shellSyntax);
    }
  });

  it('runs the aggregate check through child processes instead of a shell', async () => {
    const source = await readFile(path.join(workspaceRoot, 'scripts/run-checks.mjs'), 'utf8');
    expect(source).toContain('spawnSync');
    expect(source).toContain('shell: false');
  });
});
