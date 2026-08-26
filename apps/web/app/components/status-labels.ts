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
  'source.sync': '来源同步',
  'source.health-check': '来源健康检查',
  'resume.profile.extract': '简历画像提取',
  'job.enrich': '职位理解',
  'match.compute-revision': '职位匹配',
  'match.score-job': '手动职位评分',
  'match.advise': '匹配建议',
};

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
