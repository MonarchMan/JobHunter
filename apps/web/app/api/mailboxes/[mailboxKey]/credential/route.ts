import { MailboxSettingsError } from '@jobhunter/application/mail-settings';
import { getWebContainer } from '../../../../../src/server/container.js';
import {
  badRequestResponse,
  dataResponse,
  errorResponse,
  notFoundResponse,
} from '../../../../../src/server/http.js';
import { verifyMutationRequest } from '../../../../../src/server/csrf.js';

/**
 * 按用户主动操作读取已保存的 IMAP 授权码；OAuth 令牌和普通快照均不回传。
 */
export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly mailboxKey: string }> },
): Promise<Response> {
  if (!verifyMutationRequest(request)) return new Response(null, { status: 403 });
  try {
    // 1、按稳定邮箱键读取唯一允许回显的 password 字段。
    const { mailboxKey } = await context.params;
    const password = await (await getWebContainer()).services.mailboxes.readCredential(mailboxKey);
    // 2、禁止浏览器、代理和开发工具缓存包含明文凭据的响应。
    const response = dataResponse({ password });
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    response.headers.set('Pragma', 'no-cache');
    return response;
  } catch (error) {
    if (error instanceof MailboxSettingsError && error.code === 'not_found')
      return notFoundResponse('邮箱配置不存在。');
    if (error instanceof MailboxSettingsError)
      return badRequestResponse('该邮箱授权码暂时不可用。');
    return errorResponse(error);
  }
}
