import { performance } from 'node:perf_hooks';
import { afterEach, describe, expect, it } from 'vitest';
import { WindowsCredentialVault } from '../src/windows-credential-vault.js';

const created: WindowsCredentialVault[] = [];

afterEach(() => {
  for (const vault of created.splice(0)) vault.close();
});

describe.skipIf(process.platform !== 'win32')('WindowsCredentialVault', () => {
  it('reuses a warmed helper for a fast credential-manager operation', async () => {
    const vault = new WindowsCredentialVault();
    created.push(vault);

    await vault.warmUp();
    const startedAt = performance.now();
    await expect(vault.get('os:jobhunter/mail/jobhunter-vault-missing-test')).rejects.toThrow(
      'Credential operation failed.',
    );

    expect(performance.now() - startedAt).toBeLessThan(500);
  });
});
