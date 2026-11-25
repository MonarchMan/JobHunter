import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { ExternalMailMessageRef } from '@jobhunter/recruitment/mail-contracts';
import { GmailConnector } from '../../../src/mail/connectors/gmail.js';
import { MicrosoftGraphConnector } from '../../../src/mail/connectors/graph.js';
import { ImapConnector } from '../../../src/mail/connectors/imap.js';

const imap = vi.hoisted(() => ({
  connect: vi.fn(),
  logout: vi.fn(),
  mailboxOpen: vi.fn(),
  fetchOne: vi.fn(),
  list: vi.fn(),
  search: vi.fn(),
  fetchAll: vi.fn(),
}));

vi.mock('imapflow', () => ({
  ImapFlow: class {
    public connect = imap.connect;
    public logout = imap.logout;
    public mailboxOpen = imap.mailboxOpen;
    public fetchOne = imap.fetchOne;
    public list = imap.list;
    public search = imap.search;
    public fetchAll = imap.fetchAll;
  },
}));

const context = { mailboxKey: 'mailbox-1', credentialRef: 'credential-1' };
const reference: ExternalMailMessageRef = {
  mailboxKey: 'mailbox-1',
  providerKey: 'imap',
  externalMessageKey: 'INBOX:1:2',
  folderId: 'INBOX',
  threadKey: null,
  receivedAt: 100,
  contentVersion: '1:2',
  sourceUrl: null,
  changeKind: 'added',
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe('mail body-only boundary', () => {
  it.each([true, false])('requires an exact ID match to recover IMAP mail: %s', async (match) => {
    const messageId = '<fixture@example.test>';
    imap.connect.mockResolvedValue(undefined);
    imap.logout.mockResolvedValue(undefined);
    imap.mailboxOpen.mockResolvedValue({ uidValidity: 1n });
    imap.list.mockResolvedValue([
      { path: 'INBOX', flags: new Set() },
      { path: 'Archive', flags: new Set() },
    ]);
    imap.search.mockResolvedValue([8, 9]);
    imap.fetchAll.mockResolvedValue([
      { uid: 8, envelope: { messageId: '<other@example.test>' } },
      { uid: 9, envelope: { messageId: match ? messageId : '<another@example.test>' } },
    ]);
    imap.fetchOne
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce({
        uid: 9,
        bodyStructure: { type: 'text/plain', encoding: '8bit' },
      })
      .mockResolvedValueOnce({
        uid: 9,
        bodyParts: new Map([['1', Buffer.from('Recovered body')]]),
      });
    const connector = new ImapConnector(() =>
      Promise.resolve({ host: 'imap.example.test', user: 'fixture', password: 'fixture' }),
    );
    const pending = connector.fetchMessage(
      { ...context, messageIdHash: createHash('sha256').update(messageId).digest('hex') },
      reference,
    );
    if (match) {
      await expect(pending).resolves.toMatchObject({
        externalMessageKey: reference.externalMessageKey,
        textBody: 'Recovered body',
      });
      expect(imap.fetchOne.mock.calls.map(([uid]) => uid)).toEqual(['2', '9', '9']);
    } else {
      await expect(pending).rejects.toMatchObject({ category: 'message_not_found' });
      expect(imap.fetchOne).toHaveBeenCalledOnce();
    }
    expect(imap.mailboxOpen).toHaveBeenLastCalledWith('Archive', { readOnly: true });
  });

  it('treats messages in Junk and Trash as permanently unavailable', async () => {
    imap.connect.mockResolvedValue(undefined);
    imap.logout.mockResolvedValue(undefined);
    imap.mailboxOpen.mockResolvedValue({ uidValidity: 1n });
    imap.list.mockResolvedValue([
      { path: 'Junk', specialUse: '\\Junk', flags: new Set() },
      { path: 'Trash', flags: new Set(['\\Trash']) },
    ]);
    imap.fetchOne.mockResolvedValue(false);
    const connector = new ImapConnector(() =>
      Promise.resolve({ host: 'imap.example.test', user: 'fixture', password: 'fixture' }),
    );
    await expect(
      connector.fetchMessage(
        {
          ...context,
          messageIdHash: createHash('sha256').update('<deleted@example.test>').digest('hex'),
        },
        reference,
      ),
    ).rejects.toMatchObject({ category: 'message_not_found' });
    expect(imap.mailboxOpen).toHaveBeenCalledTimes(1);
    expect(imap.search).not.toHaveBeenCalled();
  });

  it('does not expose calendar, text attachments, or nested message bodies from Gmail', async () => {
    const encode = (value: string): string => Buffer.from(value).toString('base64url');
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'gmail-1',
          payload: {
            mimeType: 'multipart/mixed',
            parts: [
              {
                mimeType: 'text/plain',
                filename: 'secret.txt',
                body: { data: encode('ATTACHMENT_SECRET') },
              },
              { mimeType: 'text/calendar', body: { data: encode('VCALENDAR_SECRET') } },
              {
                mimeType: 'message/rfc822',
                parts: [{ mimeType: 'text/plain', body: { data: encode('NESTED_SECRET') } }],
              },
              { mimeType: 'text/plain', body: { data: encode('示例面试邀请正文') } },
            ],
          },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetcher);

    const message = await new GmailConnector(() =>
      Promise.resolve({ accessToken: 'test-token' }),
    ).fetchMessage(context, { ...reference, providerKey: 'gmail', externalMessageKey: 'gmail-1' });

    expect(message.textBody).toBe('示例面试邀请正文');
    expect(JSON.stringify(message)).not.toContain('SECRET');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('requests only message fields from Graph without downloading attachments', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'graph-1',
          body: { contentType: 'html', content: '<p>面试邀请</p>' },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetcher);

    const message = await new MicrosoftGraphConnector(() =>
      Promise.resolve({ accessToken: 'test-token' }),
    ).fetchMessage(context, {
      ...reference,
      providerKey: 'microsoft-graph',
      externalMessageKey: 'graph-1',
    });

    expect(message.htmlBody).toBe('<p>面试邀请</p>');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).not.toContain('attachments');
  });

  it('fetches only current IMAP body parts and skips entire attachment subtrees', async () => {
    imap.connect.mockResolvedValue(undefined);
    imap.logout.mockResolvedValue(undefined);
    imap.mailboxOpen.mockResolvedValue({ uidValidity: 1n });
    imap.fetchOne
      .mockResolvedValueOnce({
        envelope: {
          subject: '面试邀请',
          from: [{ name: '招聘团队', address: 'test@example.test' }],
        },
        bodyStructure: {
          type: 'multipart/mixed',
          childNodes: [
            { part: '1', type: 'text/plain', encoding: '8bit', parameters: { charset: 'utf-8' } },
            { part: '2', type: 'text/calendar' },
            { part: '3', type: 'text/plain', disposition: 'attachment' },
            {
              part: '4',
              type: 'message/rfc822',
              childNodes: [{ part: '4.1', type: 'text/plain' }],
            },
            {
              part: '5',
              type: 'multipart/mixed',
              disposition: 'attachment',
              childNodes: [{ part: '5.1', type: 'text/plain' }],
            },
          ],
        },
      })
      .mockResolvedValueOnce({ bodyParts: new Map([['1', Buffer.from('示例面试正文')]]) });

    const message = await new ImapConnector(() =>
      Promise.resolve({
        host: 'imap.example.test',
        user: 'test@example.test',
        password: 'test-password',
      }),
    ).fetchMessage(context, reference);

    expect(message.textBody).toContain('示例面试正文');
    expect(imap.mailboxOpen).toHaveBeenCalledWith('INBOX', { readOnly: true });
    expect(imap.fetchOne.mock.calls[1]?.[1]).toEqual({
      uid: true,
      bodyParts: [{ key: '1', maxLength: 200_000 }],
    });
    expect(imap.logout).toHaveBeenCalledOnce();
  });

  it('fetches a root single-part IMAP body using section one', async () => {
    imap.connect.mockResolvedValue(undefined);
    imap.logout.mockResolvedValue(undefined);
    imap.mailboxOpen.mockResolvedValue({ uidValidity: 1n });
    imap.fetchOne
      .mockResolvedValueOnce({
        envelope: {
          subject: '面试邀请',
          from: [{ name: '招聘团队', address: 'test@example.test' }],
        },
        bodyStructure: { type: 'text/html', encoding: '8bit', parameters: { charset: 'utf-8' } },
      })
      .mockResolvedValueOnce({
        bodyParts: new Map([['1', Buffer.from('<p>腾讯面试邀请正文</p>')]]),
      });

    const message = await new ImapConnector(() =>
      Promise.resolve({
        host: 'imap.example.test',
        user: 'test@example.test',
        password: 'test-password',
      }),
    ).fetchMessage(context, reference);

    expect(message.htmlBody).toContain('腾讯面试邀请正文');
    expect(imap.fetchOne.mock.calls[1]?.[1]).toEqual({
      uid: true,
      bodyParts: [{ key: '1', maxLength: 400_000 }],
    });
  });
});
