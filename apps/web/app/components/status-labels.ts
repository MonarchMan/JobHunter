export const jobStatusLabels = {
  active: '在招',
  stale: '待确认',
  closed: '已关闭',
} as const;

export const taskStatusLabels = {
  pending: '待处理',
  running: '执行中',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
} as const;

export const agentRunStatusLabels = {
  pending: '待处理',
  running: '执行中',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
} as const;

export const taskTypeLabels: Readonly<Record<string, string>> = {
  'platform.boss': 'BOSS 平台浏览',
  'platform.51job': '前程无忧',
  'platform.zhilian': '智联平台浏览',
  'platform.liepin': '猎聘平台浏览',
  'platform.retention': '平台数据保留清理',
  'source.sync': '来源同步',
  'source.health-check': '来源健康检查',
  'source.job-detail': '职位详情同步',
  'resume.profile.extract': '简历画像提取',
  'resume.polish': '简历润色',
  'resume.export.pdf@v1': '简历 PDF 导出',
  'resume.export.cleanup@v1': '简历导出文件清理',
  'resume.delete.confirmed': '简历删除',
  'resume.artifact.purge': '简历文件清理',
  'match.compute-revision': '职位匹配',
  'match.score-job': '手动职位评分',
  'match.score-batch': '批量职位评分',
  'ai.reply': 'AI 模拟面试',
  'interview.experience-research': '面经研究流程',
  'interview.experience-research.execute': '面经采集与导入',
  'mailbox.sync@v1': '邮箱同步',
  'maintenance.cleanup': '系统数据清理',
  'maintenance.sqlite': '数据库空间整理',
};

/** 将内部任务类型映射为中文展示名，未知扩展类型不泄漏机器标识到界面。 */
export function labelTaskType(value: string): string {
  return taskTypeLabels[value] ?? '其他后台任务';
}

const agentKeyLabels: Readonly<Record<string, string>> = {
  'resume-profile': '简历画像提取',
  'resume-polish': '简历润色',
  'job-analysis': '职位分析',
  'ai.reply': 'AI 模拟面试',
  'interview.community-research-configured-model': '面经研究',
  'recruitment-mail.classify': '招聘邮件分析',
};

/** 已登记 Agent 展示业务名称，历史或未识别类型统一显示“未知”。 */
export function labelAgentKey(value: string): string {
  return agentKeyLabels[value] ?? '未知';
}

const agentErrorCategoryLabels: Readonly<Record<string, string>> = {
  rate_limited: '请求频率受限',
  temporary: '临时错误',
  invalid_auth: '身份验证失败',
  invalid_request: '请求无效',
  content_rejected: '内容被拒绝',
  cancelled: '已取消',
  timeout: '请求超时',
  budget_exceeded: '调用预算超限',
  invalid_output: '输出格式无效',
  tool_error: '工具调用失败',
  configuration: '配置错误',
  cache_race_resolved: '缓存冲突已处理',
  unknown: '未知错误',
};

/** 将 Agent 错误分类转换为中文说明，未登记的分类统一显示其他错误。 */
export function labelAgentErrorCategory(value: string): string {
  return agentErrorCategoryLabels[value] ?? '其他错误';
}

export const supportStatusLabels = {
  supported: '已支持',
  experimental: '实验中',
  blocked: '已阻塞',
} as const;

export const syncRunStatusLabels = {
  pending: '待处理',
  running: '同步中',
  partial: '部分成功',
  succeeded: '同步成功',
  failed: '同步失败',
  cancelled: '已取消',
} as const;

export const coverageLabels = {
  complete: '完整覆盖',
  partial: '部分覆盖',
  unknown: '覆盖未知',
  none: '未采集',
} as const;

export const syncStatLabels = {
  discovered: '发现',
  restored: '恢复',
  created: '新增',
  updated: '更新',
  unchanged: '未变化',
  closed: '关闭',
  staled: '转为待确认',
  failed: '失败',
  revised: '修订',
  isolated: '解析隔离',
  skippedNonDomestic: '跳过境外职位',
  skippedUnknownRegion: '跳过地域不明',
  skippedOutOfScope: '按求职意向跳过',
  followupEnqueued: '后续任务',
} as const;

export function labelStatus(labels: Readonly<Record<string, string>>, value: string): string {
  return labels[value] ?? value;
}
