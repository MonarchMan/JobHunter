import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileMailboxConfigStore } from '../src/mailbox-config-store.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('FileMailboxConfigStore', () => {
  it('creates a versioned document and atomically replaces entries without secrets', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'jobhunter-mail-config-'));
    roots.push(root);
    const filePath = path.join(root, 'mail', 'mailboxes.json');
    const store = new FileMailboxConfigStore(filePath);
    await store.upsert({
      mailboxKey: 'personal-qq',
      providerKey: 'imap',
      maskedAddress: '1***@qq.com',
      credentialRef: 'os:jobhunter/mail/personal-qq',
      folders: ['INBOX'],
      initialLookbackDays: 90,
      enabled: true,
    });

    expect(await store.list()).toHaveLength(1);
    const persisted = await readFile(filePath, 'utf8');
    expect(JSON.parse(persisted)).toEqual({
      version: 1,
      mailboxes: [
        expect.objectContaining({
          mailboxKey: 'personal-qq',
          credentialRef: 'os:jobhunter/mail/personal-qq',
        }),
      ],
    });
    expect(persisted).not.toContain('password');
  });
});
