import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CredentialNotFoundError,
  EncryptedFileCredentialVault,
  MigratingCredentialVault,
} from '../src/encrypted-file-credential-vault.js';
import type { WritableCredentialVault } from '@jobhunter/mail-core';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('EncryptedFileCredentialVault', () => {
  it('encrypts credentials, reopens them with the generated key, and revokes them', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'jobhunter-mail-credentials-'));
    roots.push(root);
    const filePath = path.join(root, 'credentials.enc.json');
    const keyFilePath = path.join(root, 'credentials.key');
    const ref = 'os:jobhunter/mail/personal-qq';
    const first = new EncryptedFileCredentialVault({ filePath, keyFilePath });

    await first.put(ref, { user: 'candidate@qq.com', password: 'authorization-code' });
    const persisted = await readFile(filePath, 'utf8');
    expect(persisted).not.toContain('candidate@qq.com');
    expect(persisted).not.toContain('authorization-code');

    const reopened = new EncryptedFileCredentialVault({ filePath, keyFilePath });
    await expect(reopened.get(ref)).resolves.toEqual({
      user: 'candidate@qq.com',
      password: 'authorization-code',
    });
    await reopened.revoke(ref);
    await expect(reopened.get(ref)).rejects.toBeInstanceOf(CredentialNotFoundError);
  });

  it('isolates records with authenticated references and preserves concurrent writes', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'jobhunter-mail-credentials-'));
    roots.push(root);
    const vault = new EncryptedFileCredentialVault({
      filePath: path.join(root, 'credentials.enc.json'),
      keyFilePath: path.join(root, 'credentials.key'),
    });

    await Promise.all([
      vault.put('os:jobhunter/mail/first', { password: 'first-secret' }),
      vault.put('os:jobhunter/mail/second', { password: 'second-secret' }),
    ]);

    await expect(vault.get('os:jobhunter/mail/first')).resolves.toEqual({
      password: 'first-secret',
    });
    await expect(vault.get('os:jobhunter/mail/second')).resolves.toEqual({
      password: 'second-secret',
    });
  });

  it('uses an external key and rejects swapped records or a different key', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'jobhunter-mail-credentials-'));
    roots.push(root);
    const filePath = path.join(root, 'credentials.enc.json');
    const keyFilePath = path.join(root, 'unused.key');
    const options = { filePath, keyFilePath, masterKey: 'ab'.repeat(32) };
    const vault = new EncryptedFileCredentialVault(options);
    const firstRef = 'os:jobhunter/mail/first';
    const secondRef = 'os:jobhunter/mail/second';
    await vault.put(firstRef, { password: 'first-secret' });
    await vault.put(secondRef, { password: 'second-secret' });
    await expect(readFile(keyFilePath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(new EncryptedFileCredentialVault(options).get(firstRef)).resolves.toEqual({
      password: 'first-secret',
    });
    await expect(
      new EncryptedFileCredentialVault({ ...options, masterKey: 'cd'.repeat(32) }).get(firstRef),
    ).rejects.toThrow('cannot be decrypted');

    const document = JSON.parse(await readFile(filePath, 'utf8')) as {
      records: Record<string, unknown>;
    };
    [document.records[firstRef], document.records[secondRef]] = [
      document.records[secondRef],
      document.records[firstRef],
    ];
    await writeFile(filePath, JSON.stringify(document));
    await expect(vault.get(firstRef)).rejects.toThrow('cannot be decrypted');
  });

  it('does not create a replacement key or change ciphertext when an existing key is lost', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'jobhunter-mail-credentials-'));
    roots.push(root);
    const filePath = path.join(root, 'credentials.enc.json');
    const keyFilePath = path.join(root, 'credentials.key');
    await new EncryptedFileCredentialVault({ filePath, keyFilePath }).put(
      'os:jobhunter/mail/first',
      { password: 'first-secret' },
    );
    const before = await readFile(filePath, 'utf8');
    await rm(keyFilePath);
    const reopened = new EncryptedFileCredentialVault({ filePath, keyFilePath });

    await expect(reopened.get('os:jobhunter/mail/first')).rejects.toThrow('cannot be decrypted');
    await expect(
      reopened.put('os:jobhunter/mail/second', { password: 'second-secret' }),
    ).rejects.toThrow('key file is unavailable');
    expect(await readFile(filePath, 'utf8')).toBe(before);
    await expect(readFile(keyFilePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('MigratingCredentialVault', () => {
  it('actively copies a missing legacy credential into the encrypted primary and revokes the legacy copy', async () => {
    const primary = new MemoryCredentialVault();
    const legacy = new MemoryCredentialVault();
    const ref = 'os:jobhunter/mail/legacy-qq';
    await legacy.put(ref, { password: 'legacy-secret' });
    const vault = new MigratingCredentialVault(primary, legacy);

    await expect(vault.migrate(ref)).resolves.toBe(true);
    await expect(primary.get(ref)).resolves.toEqual({ password: 'legacy-secret' });
    await expect(legacy.get(ref)).rejects.toBeInstanceOf(CredentialNotFoundError);
    await expect(vault.migrate(ref)).resolves.toBe(false);
  });

  it('keeps the legacy credential when encrypted-file verification fails', async () => {
    const primary = new CorruptingCredentialVault();
    const legacy = new MemoryCredentialVault();
    const ref = 'os:jobhunter/mail/legacy-qq';
    await legacy.put(ref, { password: 'legacy-secret' });
    const vault = new MigratingCredentialVault(primary, legacy);

    await expect(vault.migrate(ref)).rejects.toThrow('verification failed');
    await expect(legacy.get(ref)).resolves.toEqual({ password: 'legacy-secret' });
    await expect(primary.get(ref)).rejects.toBeInstanceOf(CredentialNotFoundError);
  });

  it('migrates all configured references without stopping after a missing legacy entry', async () => {
    const primary = new MemoryCredentialVault();
    const legacy = new MemoryCredentialVault();
    await legacy.put('os:jobhunter/mail/first', { password: 'first-secret' });
    await legacy.put('os:jobhunter/mail/second', { password: 'second-secret' });
    const vault = new MigratingCredentialVault(primary, legacy);

    await expect(
      vault.migrateAll([
        'os:jobhunter/mail/first',
        'os:jobhunter/mail/missing',
        'os:jobhunter/mail/second',
        'os:jobhunter/mail/first',
      ]),
    ).resolves.toEqual({ migrated: 2, skipped: 0, failed: 1 });
    await expect(primary.get('os:jobhunter/mail/first')).resolves.toEqual({
      password: 'first-secret',
    });
    await expect(primary.get('os:jobhunter/mail/second')).resolves.toEqual({
      password: 'second-secret',
    });
  });
});

/** 测试迁移流程使用的最小内存凭据库。 */
class MemoryCredentialVault implements WritableCredentialVault {
  readonly #values = new Map<string, Readonly<Record<string, string>>>();

  public put(ref: string, values: Readonly<Record<string, string>>): Promise<void> {
    this.#values.set(ref, { ...values });
    return Promise.resolve();
  }

  public get(ref: string): Promise<Readonly<Record<string, string>>> {
    const values = this.#values.get(ref);
    return values ? Promise.resolve({ ...values }) : Promise.reject(new CredentialNotFoundError());
  }

  public revoke(ref: string): Promise<void> {
    this.#values.delete(ref);
    return Promise.resolve();
  }
}

/** 模拟落盘后内容不一致，用于验证迁移失败不会删除旧凭据。 */
class CorruptingCredentialVault extends MemoryCredentialVault {
  public override get(ref: string): Promise<Readonly<Record<string, string>>> {
    return super.get(ref).then(() => ({ password: 'corrupted-secret' }));
  }
}
