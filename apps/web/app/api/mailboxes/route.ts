import {
  imapMailboxCreateSchema,
  MailboxSettingsError,
} from '@jobhunter/application/mail-settings';
import { ZodError } from 'zod';
import { getWebContainer } from '../../../src/server/container.js';
import {
  badRequestResponse,
  dataResponse,
  errorResponse,
  forbiddenResponse,
} from '../../../src/server/http.js';
import { verifyMutationRequest } from '../../../src/server/csrf.js';

/** 读取邮箱配置和最近同步状态的脱敏投影。 */
export async function GET(): Promise<Response> {
  try {
    return dataResponse(await (await getWebContainer()).services.mailboxes.snapshot());
  } catch (error) {
    return errorResponse(error);
  }
}

/** 创建 IMAP/QQ 邮箱；授权码只在服务端短暂传递到加密凭据文件。 */
export async function POST(request: Request): Promise<Response> {
  if (!verifyMutationRequest(request)) return forbiddenResponse();
  try {
    const input = imapMailboxCreateSchema.parse(await request.json());
    const mailbox = await (await getWebContainer()).services.mailboxes.createImap(input);
    return dataResponse(mailbox, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError || error instanceof MailboxSettingsError) {
      return badRequestResponse('邮箱配置无效，请检查地址、授权码和 IMAP 参数。');
    }
    return errorResponse(error);
  }
}
