import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server.js';

export function dataResponse(data: unknown, init?: ResponseInit): NextResponse {
  return NextResponse.json({ data }, init);
}

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
