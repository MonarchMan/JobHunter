import { getWebLogger } from './logging.js';
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server.js';
import { isSqliteMaintenanceError } from '@jobhunter/common/persistence/maintenance';
import { HostBridgeConnectionError } from '@jobhunter/common/task-host-runtime';

/** 写锁等待可能先于维护触发器超时，统一返回可重试响应而非内部错误。 */
function isDatabaseBusy(error: unknown): boolean {
  const seen = new Set<unknown>();
  while (error instanceof Error && !seen.has(error)) {
    if ('code' in error && (error.code === 'SQLITE_BUSY' || error.code === 'SQLITE_LOCKED'))
      return true;
    seen.add(error);
    error = error.cause;
  }
  return false;
}

/** 生成统一 JSON 成功响应。 */
export function dataResponse(data: unknown, init?: ResponseInit): NextResponse {
  return NextResponse.json({ data }, init);
}

/** 将未知异常映射为统一 JSON 错误响应。 */
export async function errorResponse(error: unknown, request?: Request): Promise<NextResponse> {
  const correlationId = randomUUID();
  const logger = await getWebLogger();
  let requestFields = {};
  if (request) {
    try {
      requestFields = { method: request.method, path: new URL(request.url).pathname };
    } catch {
      /* 无效 URL 不影响错误响应。 */
    }
  }
  const unavailable = (message: string): NextResponse => {
    logger.warn('web.request_failed', { correlationId, ...requestFields, statusCode: 503, error });
    return serviceUnavailableResponse(message, correlationId);
  };
  if (
    error instanceof Error &&
    'code' in error &&
    error.code === 'DATABASE_UPGRADE_REQUIRES_STOP'
  ) {
    return unavailable('数据库升级需要先关闭当前 Web/CLI 宿主及其他数据库连接。');
  }
  if (error instanceof HostBridgeConnectionError) {
    return unavailable(
      error.code === 'incompatible'
        ? '任务宿主配置已变化，请关闭并重新启动 Web 后重试。'
        : '任务宿主暂不可用，请稍后重试或查看运行日志。',
    );
  }
  // 1、维护写保护是暂时不可用，保留客户端草稿并允许稍后重试。
  if (isSqliteMaintenanceError(error) || isDatabaseBusy(error)) {
    const response = unavailable('数据库正在整理或暂时繁忙，请稍后重试。');
    response.headers.set('Retry-After', '5');
    return response;
  }
  logger.error('web.request_failed', { correlationId, ...requestFields, statusCode: 500, error });
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
export function serviceUnavailableResponse(
  message: string,
  correlationId = randomUUID(),
): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message,
        correlationId,
      },
    },
    { status: 503 },
  );
}
