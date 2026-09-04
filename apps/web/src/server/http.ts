import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server.js';

/** 生成统一 JSON 成功响应。 */
export function dataResponse(data: unknown, init?: ResponseInit): NextResponse {
  return NextResponse.json({ data }, init);
}

/** 将未知异常映射为统一 JSON 错误响应。 */
export function errorResponse(error: unknown): NextResponse {
  const correlationId = randomUUID();
  // Detailed failures belong in the redacted server logger; HTTP never exposes stacks.
  process.stderr.write(
    `Web request failed [${correlationId}]: ${error instanceof Error ? error.name : 'UnknownError'}\n`,
  );
  return NextResponse.json(
    {
      error: {
        code: 'INTERNAL_ERROR',
        message: '请求处理失败，请稍后重试。',
        correlationId,
      },
    },
    { status: 500 },
  );
}

/** 返回 400 参数错误响应。 */
export function badRequestResponse(message = '筛选参数无效。'): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: 'INVALID_QUERY',
        message,
        correlationId: randomUUID(),
      },
    },
    { status: 400 },
  );
}

/** 返回 404 资源不存在响应。 */
export function notFoundResponse(message = '资源不存在。'): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: 'NOT_FOUND',
        message,
        correlationId: randomUUID(),
      },
    },
    { status: 404 },
  );
}

/** 返回 403 安全校验失败响应。 */
export function forbiddenResponse(message = '安全校验失败，请刷新页面后重试。'): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: 'MUTATION_FORBIDDEN',
        message,
        correlationId: randomUUID(),
      },
    },
    { status: 403 },
  );
}

/** 返回 409 乐观锁或幂等冲突响应。 */
export function conflictResponse(
  code: string,
  message: string,
  details: Readonly<Record<string, unknown>>,
): NextResponse {
  return NextResponse.json(
    { error: { code, message, correlationId: randomUUID(), details } },
    { status: 409 },
  );
}

/** 返回 503 临时能力不可用响应，客户端可以保留上下文后重试。 */
export function serviceUnavailableResponse(message: string): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message,
        correlationId: randomUUID(),
      },
    },
    { status: 503 },
  );
}
