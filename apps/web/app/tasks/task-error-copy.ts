/** 将调度分类转为任务详情标题，保留可读的具体诊断。 */
const titles: Readonly<Record<string, string>> = {
  rate_limited: '请求频率受限',
  network_temporary: '网络请求未完成',
  io_temporary: '本地读写失败',
  upstream_5xx: '上游服务异常',
  parse_changed: '来源数据格式或身份校验失败',
  invalid_config: '配置或认证无效',
  validation_failed: '结果校验失败',
  cancelled: '任务已取消',
  orphaned_run: '同步执行中断',
  partial_coverage: '同步覆盖不完整',
  isolated_items: '部分职位已跳过',
  batch_partial_failure: '部分职位详情处理失败',
};

/** 为历史摘要提供具体表述，来源已提供的其他详细原因原样保留。 */
const summaries: Readonly<Record<string, readonly [title: string, reason: string]>> = {
  'Lease expired after final attempt.': [
    '任务执行中断',
    '后台执行器在最后一次尝试时停止报告进度，任务未能完成。',
  ],
  'Task worker exited.': ['后台执行器退出', '后台执行器在任务完成前退出。'],
  'Browser operation failed.': ['浏览器操作失败', '采集浏览器未能完成本次操作。'],
  'Browser operation timed out.': ['浏览器操作超时', '采集浏览器未在规定时间内完成操作。'],
  'Source request failed.': ['来源请求失败', '向招聘来源发起的请求未能完成。'],
  'Source request was aborted or timed out.': [
    '来源请求中断',
    '向招聘来源发起的请求被中止或超时。',
  ],
  'Kuaishou official runtime did not become ready.': [
    '快手招聘页面未就绪',
    '快手官网的职位列表未能在规定时间内初始化。',
  ],
  'Bilibili campus list schema changed.': [
    'B 站校园职位列表解析失败',
    '官网返回的列表结构与当前采集器支持的格式不一致。',
  ],
  'One or more jobs were isolated.': ['部分职位已跳过', '部分职位未通过详情解析或身份校验。'],
  'Source list coverage was incomplete.': ['同步覆盖不完整', '未能完整获取来源的职位列表。'],
  duplicate_job_ids: ['来源返回重复职位', '来源列表返回了重复职位，系统无法确认已覆盖全部职位。'],
  pagination_total_changed: [
    '分页期间职位总数变化',
    '来源报告的职位总数在翻页时发生变化，本轮覆盖不完整。',
  ],
};

/** 旧平台记录可能只有通用异常文本，仍可从固定分类还原说明。 */
const historicalPlatform: Readonly<Record<string, readonly [title: string, reason: string]>> = {
  session_unavailable: [
    'Chrome 连接或平台会话不可用',
    'JobHunter 未能建立或继续使用本次浏览器会话。请检查 Chrome 调试连接并重新连接。',
  ],
  access_blocked: ['招聘平台限制访问', '平台拒绝了请求，已停止本批获取。'],
  rate_limited: ['招聘平台请求过于频繁', '平台限制了请求频率，已停止本批获取。'],
  parse_changed: ['职位数据校验失败', '平台返回的数据格式或职位身份未通过校验。'],
  network_error: ['招聘平台网络请求失败', '向招聘平台发起的请求未能完成。'],
  upstream_error: ['招聘平台响应异常', '招聘平台返回异常响应，已停止本批获取。'],
};

/** 将已知摘要和分类映射为标题与原因，未知分类使用任务状态兜底。 */
export function taskErrorCopy(
  summary: string | null | undefined,
  category: string | null | undefined,
  warning = false,
): { title: string; message: string } {
  const platformCode = /^Platform request failed: ([a-z_]+)\b/u.exec(summary ?? '')?.[1];
  const mapped = platformCode
    ? historicalPlatform[platformCode]
    : summary
      ? summaries[summary]
      : undefined;
  return {
    title:
      mapped?.[0] ??
      (category ? titles[category] : undefined) ??
      (warning ? '任务完成时有异常' : '任务未能完成'),
    message: mapped?.[1] ?? summary ?? '',
  };
}
