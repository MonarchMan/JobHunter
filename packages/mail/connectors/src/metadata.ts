import type { MailConnectorMetadata } from '@jobhunter/mail-core';

/** Gmail 能力声明；Web 与实际连接器共用同一份数据，避免为读取能力加载协议实现。 */
export const gmailConnectorMetadata = {
  providerKey: 'gmail',
  version: 'gmail-api-v1',
  authKind: 'oauth',
  incrementalMode: 'history',
  folderMode: 'labels',
  supportsStableMessageId: true,
  supportStatus: 'experimental',
} as const satisfies MailConnectorMetadata;

/** Microsoft Graph 只读邮箱连接器的能力声明。 */
export const graphConnectorMetadata = {
  providerKey: 'microsoft-graph',
  version: 'graph-v1.0',
  authKind: 'oauth',
  incrementalMode: 'delta',
  folderMode: 'folders',
  supportsStableMessageId: true,
  supportStatus: 'experimental',
} as const satisfies MailConnectorMetadata;

/** IMAP over TLS 只读连接器的能力声明。 */
export const imapConnectorMetadata = {
  providerKey: 'imap',
  version: 'imap-tls-v1',
  authKind: 'app_password',
  incrementalMode: 'imap_uid',
  folderMode: 'folders',
  supportsStableMessageId: true,
  supportStatus: 'experimental',
} as const satisfies MailConnectorMetadata;

/** 设置页可用连接器列表；顺序与运行时注册顺序一致。 */
export const mailConnectorMetadata = [
  gmailConnectorMetadata,
  graphConnectorMetadata,
  imapConnectorMetadata,
] as const satisfies readonly MailConnectorMetadata[];
