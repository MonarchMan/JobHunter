import { mailboxSettingsUpdateSchema, MailboxSettingsError } from '@jobhunter/application/web';
import { ZodError } from 'zod';
import { getWebContainer } from '../../../../src/server/container.js';
import {
  badRequestResponse,
  dataResponse,
  errorResponse,
  forbiddenResponse,
  notFoundResponse,
} from '../../../../src/server/http.js';
import { verifyMutationRequest } from '../../../../src/server/csrf.js';

/** 修改邮箱启停、扫描范围，并可用新授权码覆盖系统凭据。 */
export async function PATCH(
  request: Request,
  context: { readonly params: Promise<{ readonly mailboxKey: string }> },
): Promise<Response> {
  if (!verifyMutationRequest(request)) return forbiddenResponse();
  try {
    const { mailboxKey } = await context.params;
    const input = mailboxSettingsUpdateSchema.parse(await request.json());
    const mailbox = await (await getWebContainer()).services.mailboxes.update(mailboxKey, input);
    return dataResponse(mailbox);
  } catch (error) {
    if (error instanceof MailboxSettingsError && error.code === 'not_found')
      return notFoundResponse('邮箱配置不存在。');
    if (error instanceof ZodError || error instanceof MailboxSettingsError)
      return badRequestResponse('邮箱设置无效。');
    return errorResponse(error);
  }
}

/** 断开邮箱并撤销操作系统凭据。 */
export async function DELETE(
  request: Request,
  context: { readonly params: Promise<{ readonly mailboxKey: string }> },
): Promise<Response> {
  if (!verifyMutationRequest(request)) return forbiddenResponse();
  try {
    const { mailboxKey } = await context.params;
    await (await getWebContainer()).services.mailboxes.disconnect(mailboxKey);
    return dataResponse({ mailboxKey, disconnected: true });
  } catch (error) {
    if (error instanceof MailboxSettingsError && error.code === 'not_found')
      return notFoundResponse('邮箱配置不存在。');
    return errorResponse(error);
  }
}
