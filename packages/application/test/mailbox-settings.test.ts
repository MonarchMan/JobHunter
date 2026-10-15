import { describe, expect, it } from 'vitest';
import {
  MailboxSettingsService,
  type MailboxConfigStorePort,
  type MailboxRuntimeStatePort,
} from '../src/mail/mailbox-settings-service.js';
import type {
  MailConnectorMetadata,
  MailboxConfig,
  MailboxRuntimeState,
  WritableCredentialVault,
} from '@jobhunter/mail-core';

class MemoryConfigStore implements MailboxConfigStorePort {
  readonly values: MailboxConfig[] = [];
  readonly filePath = 'C:/test/mailboxes.json';

  public list(): Promise<readonly MailboxConfig[]> {
    return Promise.resolve(this.values.map((value) => ({ ...value, folders: [...value.folders] })));
  }

  public upsert(config: MailboxConfig): Promise<void> {
    const index = this.values.findIndex((value) => value.mailboxKey === config.mailboxKey);
    if (index < 0) this.values.push(config);
    else this.values[index] = config;
    return Promise.resolve();
  }

  public remove(mailboxKey: string): Promise<void> {
    const index = this.values.findIndex((value) => value.mailboxKey === mailboxKey);
    if (index >= 0) this.values.splice(index, 1);
    return Promise.resolve();
  }
}

class MemoryCredentials implements WritableCredentialVault {
  readonly values = new Map<string, Readonly<Record<string, string>>>();
  readonly revoked: string[] = [];

  public put(ref: string, values: Readonly<Record<string, string>>): Promise<void> {
    this.values.set(ref, values);
    return Promise.resolve();
  }

  public get(ref: string): Promise<Readonly<Record<string, string>>> {
    const value = this.values.get(ref);
    if (!value) throw new Error('missing');
    return Promise.resolve(value);
  }

  public revoke(ref: string): Promise<void> {
    this.revoked.push(ref);
    this.values.delete(ref);
    return Promise.resolve();
  }
}

class MemoryRuntime implements MailboxRuntimeStatePort {
  readonly values = new Map<string, MailboxRuntimeState>();
  readonly removed: string[] = [];

  public read(mailboxKey: string): Promise<MailboxRuntimeState | null> {
    return Promise.resolve(this.values.get(mailboxKey) ?? null);
  }

  public remove(mailboxKey: string): Promise<void> {
    this.removed.push(mailboxKey);
    this.values.delete(mailboxKey);
    return Promise.resolve();
  }
}

const metadata: readonly MailConnectorMetadata[] = [
  {
    providerKey: 'gmail',
    version: 'test',
    authKind: 'oauth',
    incrementalMode: 'history',
    folderMode: 'labels',
    supportsStableMessageId: true,
    supportStatus: 'experimental',
  },
  {
    providerKey: 'microsoft-graph',
    version: 'test',
    authKind: 'oauth',
    incrementalMode: 'delta',
    folderMode: 'folders',
    supportsStableMessageId: true,
    supportStatus: 'experimental',
  },
  {
    providerKey: 'imap',
    version: 'test',
    authKind: 'app_password',
    incrementalMode: 'imap_uid',
    folderMode: 'folders',
    supportsStableMessageId: true,
    supportStatus: 'experimental',
  },
];

describe('MailboxSettingsService', () => {
  it('keeps IMAP password in the credential vault and exposes only a masked address', async () => {
    const configs = new MemoryConfigStore();
    const credentials = new MemoryCredentials();
    const runtime = new MemoryRuntime();
    const service = new MailboxSettingsService({
      configs,
      credentials,
      runtimeState: runtime,
      metadata,
      createMailboxKey: () => 'abc123',
    });

    const mailbox = await service.createImap({
      preset: 'qq',
      address: '123456789@qq.com',
      password: 'authorization-code',
      port: 993,
      tls: 'ssl',
      folders: ['INBOX'],
      initialLookbackDays: 90,
    });

    expect(mailbox.maskedAddress).toBe('1***@qq.com');
    expect(configs.values[0]).not.toHaveProperty('password');
    expect(JSON.stringify(configs.values)).not.toContain('authorization-code');
    expect(credentials.values.has(`os:jobhunter/mail/${mailbox.mailboxKey}`)).toBe(true);
    expect(credentials.values.size).toBe(1);
    expect([...credentials.values.values()][0]).toMatchObject({
      host: 'imap.qq.com',
      user: '123456789@qq.com',
      password: 'authorization-code',
    });
    expect(await service.readCredential(mailbox.mailboxKey)).toBe('authorization-code');
  });

  it('updates enabled state and revokes credentials when disconnected', async () => {
    const configs = new MemoryConfigStore();
    const credentials = new MemoryCredentials();
    const runtime = new MemoryRuntime();
    const service = new MailboxSettingsService({
      configs,
      credentials,
      runtimeState: runtime,
      metadata,
      createMailboxKey: () => 'disconnect-me',
    });
    const mailbox = await service.createImap({
      preset: 'qq',
      address: 'u@qq.com',
      password: 'secret',
      port: 993,
      tls: 'ssl',
      folders: ['INBOX'],
      initialLookbackDays: 90,
    });

    const paused = await service.update(mailbox.mailboxKey, { enabled: false });
    expect(paused.enabled).toBe(false);
    await service.disconnect(mailbox.mailboxKey);
    expect(configs.values).toHaveLength(0);
    expect(credentials.revoked).toHaveLength(1);
    expect(runtime.removed).toEqual([mailbox.mailboxKey]);
  });

  it('stores OAuth tokens only in the credential vault and exposes a masked identity', async () => {
    const configs = new MemoryConfigStore();
    const credentials = new MemoryCredentials();
    const service = new MailboxSettingsService({
      configs,
      credentials,
      runtimeState: new MemoryRuntime(),
      metadata,
      createMailboxKey: () => 'oauth-mailbox',
    });

    const mailbox = await service.createOAuth({
      providerKey: 'gmail',
      address: 'candidate@gmail.com',
      accessToken: 'access-secret',
      refreshToken: 'refresh-secret',
      expiresAt: 1_800_000,
      scope: 'gmail.readonly',
      tokenType: 'Bearer',
      folders: ['INBOX'],
      initialLookbackDays: 90,
    });

    expect(mailbox).toMatchObject({
      providerKey: 'gmail',
      maskedAddress: 'c***@gmail.com',
      folders: ['INBOX'],
    });
    expect(JSON.stringify(configs.values)).not.toContain('access-secret');
    expect(JSON.stringify(configs.values)).not.toContain('refresh-secret');
    expect(credentials.values.get(`os:jobhunter/mail/${mailbox.mailboxKey}`)).toEqual({
      accessToken: 'access-secret',
      refreshToken: 'refresh-secret',
      expiresAt: '1800000',
      scope: 'gmail.readonly',
      tokenType: 'Bearer',
    });
  });

  it('updates a saved authorization code without exposing or replacing other credential fields', async () => {
    const configs = new MemoryConfigStore();
    const credentials = new MemoryCredentials();
    const service = new MailboxSettingsService({
      configs,
      credentials,
      runtimeState: new MemoryRuntime(),
      metadata,
      createMailboxKey: () => 'editable',
    });
    const mailbox = await service.createImap({
      preset: 'qq',
      address: 'editable@qq.com',
      password: 'old-code',
      port: 993,
      tls: 'ssl',
      folders: ['INBOX'],
      initialLookbackDays: 90,
    });

    const updated = await service.update(mailbox.mailboxKey, {
      folders: ['INBOX', '招聘'],
      initialLookbackDays: 120,
      newPassword: 'new-code',
    });

    expect(updated).toMatchObject({ folders: ['INBOX', '招聘'], initialLookbackDays: 120 });
    expect(credentials.values.get(`os:jobhunter/mail/${mailbox.mailboxKey}`)).toEqual({
      host: 'imap.qq.com',
      port: '993',
      user: 'editable@qq.com',
      password: 'new-code',
      tls: 'ssl',
    });
    expect(JSON.stringify(updated)).not.toContain('new-code');
    expect(JSON.stringify(configs.values)).not.toContain('new-code');
  });

  it('never exposes OAuth tokens through the credential read endpoint', async () => {
    const credentials = new MemoryCredentials();
    const service = new MailboxSettingsService({
      configs: new MemoryConfigStore(),
      credentials,
      runtimeState: new MemoryRuntime(),
      metadata,
      createMailboxKey: () => 'oauth-only',
    });
    const mailbox = await service.createOAuth({
      providerKey: 'gmail',
      address: 'candidate@gmail.com',
      accessToken: 'access-secret',
      refreshToken: 'refresh-secret',
      expiresAt: null,
      scope: 'gmail.readonly',
      tokenType: 'Bearer',
      folders: ['INBOX'],
      initialLookbackDays: 90,
    });

    await expect(service.readCredential(mailbox.mailboxKey)).rejects.toMatchObject({
      code: 'credential_unavailable',
    });
  });
});
