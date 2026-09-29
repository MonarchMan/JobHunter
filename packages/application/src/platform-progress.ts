import { z } from 'zod';
import { PlatformError } from '@jobhunter/platform-core';

/** 固定诊断码白名单，禁止动态消息、URL、凭据或任意上游字段进入状态投影。 */
const reasonSchema = z.enum([
  'browser_disconnected',
  'page_navigated',
  'unexpected_page',
  'duplicate_list',
  'browser_request_failed',
  'response_body_unavailable',
  'page_state_unavailable',
  'list_response_timeout',
  'page_not_ready',
  'browser_operation_timeout',
  'login_required',
  'verification_required',
  'access_blocked',
  'rate_limited',
  'browser_not_found',
  'platform_page_not_found',
  'too_many_targets',
  'security_check',
  'context_unchanged',
  'context_read_failed',
  'auth_binding_changed',
  'auth_context_missing',
  'resume_expired',
  'request_timeout',
  'connect_timeout',
  'headers_timeout',
  'body_timeout',
  'connection_reset',
  'connection_refused',
  'socket_closed',
  'dns_error',
  'unknown',
  'request_template',
  'template_required',
  'query_changed',
  'query_required',
  'content_type',
  'missing_body',
  'body_limit',
  'json',
  'envelope',
  'job_schema',
  'pagination',
  'detail_url',
  'detail_identity',
  'list',
  'list_envelope',
  'list_main',
  'list_extra',
  'list_pagination',
  'list_job',
  'list_company',
  'list_schema',
  'list_empty',
  'redirect_missing_location',
  'redirect_invalid_location',
  'redirect_external',
  'redirect_login',
  'redirect_challenge',
  'redirect_job',
  'redirect_internal_other',
  'detail',
  'template',
  'identity',
  'body',
]);

/** 当前动作阶段与固定错误；仅允许稳定职位 ID，不记录私有访问参数。 */
export const platformProgressSchema = z
  .object({
    stage: z.enum(['connect', 'list', 'detail', 'save', 'complete']),
    total: z.number().int().nonnegative().nullable(),
    processed: z.number().int().nonnegative(),
    saved: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    resumeCount: z.number().int().min(0).max(5).optional(),
    recovery: z
      .object({
        state: z.enum(['checking_context', 'waiting_context', 'resumed']),
        checks: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
    currentExternalJobId: z
      .string()
      .min(1)
      .max(512)
      // 猎聘身份带资源命名空间，只开放已知前缀，不能放行 URL 或任意冒号载荷。
      .regex(/^(?:[\w~-]+|(?:job|a):[1-9]\d*)$/)
      .optional(),
    failure: z
      .object({
        category: z.enum([
          'access_blocked',
          'rate_limited',
          'upstream_error',
          'parse_changed',
          'network_error',
          'session_unavailable',
          'cancelled',
          'internal_error',
        ]),
        businessCode: z.number().int().nullable(),
        reason: reasonSchema.nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict();
/** 持久化的任务进度；保存数量不是新增职位数，重复观察同样计入。 */
export type PlatformProgress = z.infer<typeof platformProgressSchema>;

/** 从异常提取固定字段；未知异常不猜测网络、认证或风控原因。 */
export function platformFailure(
  error: unknown,
  cancelled: boolean,
): NonNullable<PlatformProgress['failure']> {
  // 1、取消优先；不读取任何原始异常 message 或 cause。
  if (cancelled) return { category: 'cancelled', businessCode: null, reason: null };
  if (!(error instanceof PlatformError))
    return { category: 'internal_error', businessCode: null, reason: null };
  const reason = reasonSchema.safeParse(error.reason);
  return {
    category: error.category,
    businessCode: Number.isSafeInteger(error.businessCode) ? error.businessCode : null,
    reason: reason.success ? reason.data : null,
  };
}

/** 统一 Web 恢复说明，不将解析或网络错误引导成反复登录。 */
export function platformFailureMessage(failure: NonNullable<PlatformProgress['failure']>): string {
  // 1、自动发现失败说明具体前置条件，不误报登录失效。
  switch (failure.reason) {
    case 'browser_not_found':
      return '未找到 Chrome 调试连接。请在本机 Chrome 启用远程调试；自定义浏览器位置可在高级连接设置中指定。';
    case 'platform_page_not_found':
      return '未找到该平台支持的页面。请在 Chrome 打开下方官网入口并登录，然后重新获取。';
    case 'too_many_targets':
      return '该平台打开的页面过多，请关闭不需要的页面后重新获取。';
    case 'query_required':
      return '请先填写智联搜索关键词，再重新获取职位。';
    case 'auth_context_missing':
      return '未取得完整认证上下文。请在官网确认登录状态后重新连接，无需反复刷新或搜索职位。';
  }
  // 2、没有专属恢复提示时按错误类别返回通用说明。
  return {
    access_blocked: '平台限制访问，已停止请求。请在官网确认状态，恢复后再显式连接。',
    rate_limited: '平台限制请求频率，已停止请求。请稍后再显式连接。',
    upstream_error: '平台返回异常，已停止请求。请查看任务诊断，不要反复刷新。',
    parse_changed: '职位数据格式或身份校验未通过，已停止请求。请保留任务编号供排查，无需反复登录。',
    network_error: '请求发生网络异常，已停止请求。请检查网络及任务原因码。',
    session_unavailable:
      '浏览器连接或当前会话不可用。请确认所选页面，必要时显式重新连接；不代表账号已退出。',
    cancelled: '任务已取消，已入库职位保留。',
    internal_error: '本地处理失败，已停止请求。请查看任务诊断和数据库状态。',
  }[failure.category];
}
