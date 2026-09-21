/** 内置平台身份，不表示相应连接器已经实现或受支持。 */
export type PlatformProviderKey = 'boss' | 'zhilian' | '51job' | 'liepin';

/** 受信任装配元数据；来源 ID 发布后保持稳定，禁止客户端自定义。 */
export const platformDefinitions = {
  boss: {
    sourceId: '018f0000-0000-7000-8300-000000000001',
    baseUrl: 'https://www.zhipin.com/web/geek/jobs',
  },
  zhilian: { sourceId: '018f0000-0000-7000-8300-000000000002', baseUrl: 'https://www.zhaopin.com' },
  '51job': { sourceId: '018f0000-0000-7000-8300-000000000003', baseUrl: 'https://www.51job.com' },
  liepin: { sourceId: '018f0000-0000-7000-8300-000000000004', baseUrl: 'https://www.liepin.com' },
} as const satisfies Record<
  PlatformProviderKey,
  { readonly sourceId: string; readonly baseUrl: string }
>;

/** 平台失败分类不把未知业务码等同于登录失效。 */
export type PlatformErrorCategory =
  | 'access_blocked'
  | 'rate_limited'
  | 'upstream_error'
  | 'parse_changed'
  | 'network_error'
  | 'session_unavailable';

/** 仅暴露脱敏代码，禁止携带平台原始响应、请求地址或凭据。 */
export class PlatformError extends Error {
  public constructor(
    public readonly category: PlatformErrorCategory,
    public readonly businessCode: number | null = null,
    public readonly reason: string | null = null,
  ) {
    super(
      `Platform request failed: ${category}${businessCode === null ? '' : ` (${String(businessCode)})`}`,
    );
    this.name = 'PlatformError';
  }
}

/** 页面歧义只返回非敏感 ID 与固定标签，不暴露页面 URL、标题或登录上下文。 */
export class PlatformTargetSelectionRequired extends PlatformError {
  public constructor(public readonly targets: readonly { id: string; label: string }[]) {
    super('session_unavailable', null, 'target_selection_required');
  }
}

/** 列表候选是尚未取得必需正文的摘要，不冒充正式职位。 */
export interface PlatformCandidate {
  readonly externalJobId: string;
  readonly externalCompanyId: string;
  readonly title: string;
  readonly company: string;
  readonly city: string;
  readonly salary: string;
  readonly experience: string;
  readonly education: string;
  readonly sourceUrl: string;
}

/** 详情身份与列表核对后，才允许交给正式职位写入流程。 */
export interface PlatformJobDetail extends PlatformCandidate {
  readonly description: string;
}

/** 一批推荐不是来源完整快照，不提供 complete 覆盖标志。 */
export interface PlatformBatch {
  readonly candidates: readonly PlatformCandidate[];
  readonly hasMore: boolean;
  /** 缺少可靠公司身份而未进入候选集的条目数，不代表来源末页。 */
  readonly skippedMissingCompanyId?: number;
}

/** 连接基础设施对应用暴露的能力，不携带任何凭据。 */
export interface PlatformSession {
  /** 显式确认官网恢复后，只校验当前上下文；不自动刷新或发职位请求。 */
  resume?(signal: AbortSignal): Promise<void>;
  /** 仅通知底层连接关闭；订阅时已关闭须立即通知，返回函数用于释放监听。 */
  onDisconnected?(listener: () => void): () => void;
  readNext(signal: AbortSignal): Promise<PlatformBatch>;
  readDetail(externalJobId: string, signal: AbortSignal): Promise<PlatformJobDetail>;
  disconnect(): void;
}

/** 用户明确选择本机浏览器实例和页面后，才能借用会话。 */
export interface PlatformSessionProvider {
  connect(
    input: {
      readonly portFile?: string | undefined;
      readonly targetId?: string | undefined;
      /** 仅 BOSS 支持显式浏览器辅助；省略时保持原平台行为。 */
      readonly acquisitionMode?: 'http' | 'browser' | undefined;
    },
    signal: AbortSignal,
  ): Promise<PlatformSession>;
}
