import { MailConnectorRegistry } from '@jobhunter/mail-core';
import { GmailConnector } from './gmail.js';
import { MicrosoftGraphConnector } from './graph.js';
import { ImapConnector } from './imap.js';

/** 创建首批三种邮箱连接器的统一装配入口；凭据解析由应用传入。 */
export function createMailConnectorRegistry(
  credentials: (ref: string, signal?: AbortSignal) => Promise<Readonly<Record<string, string>>>,
): MailConnectorRegistry {
  const registry = new MailConnectorRegistry();
  registry.register(new GmailConnector(credentials));
  registry.register(new MicrosoftGraphConnector(credentials));
  registry.register(new ImapConnector(credentials));
  return registry;
}
