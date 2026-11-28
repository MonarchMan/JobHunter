import { z } from 'zod';
import { PlatformError } from '../contracts/index.js';

const evidenceSchema = z
  .object({
    httpStatus: z.number().int().min(100).max(599).optional(),
    pageIndex: z.number().int().nonnegative().optional(),
    rowCount: z.number().int().min(0).max(200).optional(),
    rowIndex: z.number().int().min(0).max(199).optional(),
    seenCount: z.number().int().min(0).max(200).optional(),
    externalJobId: z
      .string()
      .max(64)
      .regex(/^(job|a|lptjob):[1-9]\d*$/)
      .optional(),
    previousInternalId: z
      .string()
      .max(40)
      .regex(/^[1-9]\d*$/)
      .optional(),
    receivedInternalId: z
      .string()
      .max(40)
      .regex(/^[1-9]\d*$/)
      .optional(),
    linkIssue: z
      .enum(['invalid_url', 'other_origin', 'query_or_fragment', 'unsupported_path'])
      .optional(),
  })
  .strict();

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
  'browser_port_file_permission_denied',
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
  'query_invalid',
  'query_too_broad',
  'search_unsupported',
  'profile_required',
  'duplicate_identity',
  'content_type',
  'missing_body',
  'body_limit',
  'json',
  'envelope',
  'job_schema',
  'pagination',
  'detail_url',
  'detail_identity',
  'detail_job_id',
  'detail_title',
  'detail_company',
  'detail_company_name',
  'detail_company_url',
  'detail_company_id',
  'detail_company_name_and_url',
  'detail_company_name_and_id',
  'detail_jsonld_invalid',
  'detail_posting_missing',
  'detail_posting_multiple',
  'detail_posting_schema',
  'detail_company_identity_unavailable',
  'job_paused',
  'list',
  'list_envelope',
  'list_main',
  'list_extra',
  'list_pagination',
  'list_job',
  'list_job_url',
  'list_duplicate_in_page',
  'list_identity_conflict',
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
  'browser_response_timeout',
  'liepin_pagination_control',
  'browser_response_unavailable',
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
    batchNumber: z.number().int().positive().optional(),
    batchLimit: z.number().int().positive().optional(),
    processed: z.number().int().nonnegative(),
    saved: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    skippedPaused: z.number().int().nonnegative().optional(),
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
      .regex(/^(?:[\w~-]+|(?:job|a|lptjob):[1-9]\d*)$/)
      .optional(),
    detailStartedAt: z.number().int().nonnegative().optional(),
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
        evidence: evidenceSchema.optional(),
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
  const evidence = evidenceSchema.safeParse(error.evidence);
  return {
    category: error.category,
    businessCode: Number.isSafeInteger(error.businessCode) ? error.businessCode : null,
    reason: reason.success ? reason.data : null,
    ...(evidence.success ? { evidence: evidence.data } : {}),
  };
}

type PlatformFailure = NonNullable<PlatformProgress['failure']>;
type PlatformFailureDiagnostic = Readonly<{ title: string; message: string }>;

const verificationDiagnostic = {
  title: '招聘平台要求安全验证',
  message:
    '官网页面要求验证，已停止本批请求。请在官网自行完成验证，确认职位页正常后重新连接；已入库职位保留。',
};
const loginDiagnostic = {
  title: '招聘平台要求登录',
  message: '官网要求登录，已停止本批请求。请在官网登录后重新连接；已入库职位保留。',
};

/** 具体原因优先，标题与恢复说明共同维护。 */
const failureByReason: Partial<
  Record<NonNullable<PlatformFailure['reason']>, PlatformFailureDiagnostic>
> = {
  browser_not_found: {
    title: '未能读取 Chrome 调试连接',
    message:
      'JobHunter 未能读取 Chrome 调试端口文件。请确认 Chrome 已开启远程调试，并检查启动 JobHunter 的应用是否能读取该文件。',
  },
  browser_port_file_permission_denied: {
    title: 'Chrome 调试端口文件读取受限',
    message:
      'JobHunter 无法读取 Chrome 调试端口文件。请检查启动 JobHunter 的应用是否获准访问该文件，或在高级连接设置中指定可读取的端口文件。',
  },
  browser_disconnected: {
    title: 'Chrome 调试连接中断',
    message: 'Chrome 调试连接在任务进行中断开。请在 Chrome 保持平台页面打开，再重新连接。',
  },
  platform_page_not_found: {
    title: '未找到平台页面',
    message: '未找到该平台支持的页面。请在 Chrome 打开下方官网入口并登录，然后重新获取。',
  },
  too_many_targets: {
    title: '平台页面过多',
    message: '该平台打开的页面过多，请关闭不需要的页面后重新获取。',
  },
  query_required: {
    title: '求职意向未就绪',
    message: '缺少搜索词。日常获取请先在默认第一份个人资料填写具体意向岗位；显式调试请填写关键词。',
  },
  profile_required: {
    title: '求职意向未就绪',
    message: '未找到默认个人资料的当前版本。请先保存个人资料，再获取平台职位。',
  },
  query_invalid: {
    title: '求职意向未就绪',
    message: '个人资料中的意向岗位过长或多于 10 个，请调整为具体职位名称后重新连接。',
  },
  query_too_broad: {
    title: '求职意向未就绪',
    message:
      '意向岗位填写的是职位大类。请在独立的意向岗位输入框填写具体职位名称后重新连接，职位类别无需修改。',
  },
  search_unsupported: {
    title: '平台关键词搜索暂不可用',
    message: '该平台的关键词搜索协议尚未通过真实验收；本次没有改用推荐流，请等待搜索能力接入。',
  },
  query_changed: {
    title: '搜索条件已改变',
    message: '搜索条件已改变，请显式重新连接；旧批次不会混入新查询。',
  },
  auth_context_missing: {
    title: '未取得平台登录信息',
    message: '未取得完整认证上下文。请在官网确认登录状态后重新连接，无需反复刷新或搜索职位。',
  },
  verification_required: verificationDiagnostic,
  security_check: verificationDiagnostic,
  redirect_login: loginDiagnostic,
  login_required: loginDiagnostic,
  job_paused: {
    title: '职位已暂停招聘',
    message: '官网显示该职位已暂停招聘，未保存详情。',
  },
  content_type: {
    title: '职位接口返回格式异常',
    message:
      '职位接口未声明 JSON 响应类型，已停止读取。请检查官网是否要求登录或验证，恢复后重新连接；不要连续重试。',
  },
};

/** 为所有平台错误分类提供兜底文案。 */
const failureByCategory: Record<PlatformFailure['category'], PlatformFailureDiagnostic> = {
  access_blocked: {
    title: '招聘平台限制访问',
    message: '平台限制访问，已停止请求。请在官网确认状态，恢复后再显式连接。',
  },
  rate_limited: {
    title: '招聘平台请求过于频繁',
    message: '平台限制请求频率，已停止请求。请稍后再显式连接。',
  },
  upstream_error: {
    title: '招聘平台响应异常',
    message: '平台返回异常，已停止请求。请查看任务诊断，不要反复刷新。',
  },
  parse_changed: {
    title: '职位数据校验失败',
    message: '职位数据格式或身份校验未通过，已停止请求。请保留任务编号供排查，无需反复登录。',
  },
  network_error: {
    title: '招聘平台网络请求失败',
    message: '请求发生网络异常，已停止请求。请检查网络及任务原因码。',
  },
  session_unavailable: {
    title: 'Chrome 连接或平台会话不可用',
    message: '浏览器连接或当前会话不可用。请确认所选页面，必要时显式重新连接；不代表账号已退出。',
  },
  cancelled: {
    title: '平台任务已取消',
    message: '任务已取消，已入库职位保留。',
  },
  internal_error: {
    title: '平台任务本地处理失败',
    message: '本地处理失败，已停止请求。请查看任务诊断和数据库状态。',
  },
};

/** 从固定原因码查找诊断，未配置专属文案时使用错误分类。 */
export function describePlatformFailure(failure: PlatformFailure): PlatformFailureDiagnostic {
  return (
    (failure.reason ? failureByReason[failure.reason] : undefined) ??
    failureByCategory[failure.category]
  );
}

/** 来源页复用任务诊断的恢复说明。 */
export function platformFailureMessage(failure: PlatformFailure): string {
  return describePlatformFailure(failure).message;
}
