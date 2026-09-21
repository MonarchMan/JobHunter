'use client';
import { PlatformRetentionStatus } from './platform-retention-status.js';

import { useEffect, useRef, useState, type ReactElement, type SyntheticEvent } from 'react';
import { useRouter } from 'next/navigation.js';
import type { BossCommand, WebBossSnapshot } from '@jobhunter/application/web';
import { mutationHeaders } from '../../src/client/csrf.js';
import styles from './boss-browser.module.css';

const statusLabels: Record<string, string> = {
  connected: '已连接',
  available: '可浏览',
  disconnected: '未连接',
  unavailable: '连接不可用',
  access_blocked: '平台限制访问',
  rate_limited: '请求受限',
};

/** 平台工作区：页面只轮询本地状态，所有上游请求由显式操作驱动。 */
export function PlatformBrowser({
  initial,
  provider,
  placement = 'sources',
}: {
  readonly initial: WebBossSnapshot;
  readonly provider: 'boss' | 'zhilian' | '51job' | 'liepin';
  readonly placement?: 'sources' | 'jobs';
}): ReactElement {
  const router = useRouter();
  const label =
    provider === 'boss'
      ? 'BOSS 直聘'
      : provider === '51job'
        ? '前程无忧 · 官网辅助'
        : provider === 'liepin'
          ? '猎聘 · 学生推荐'
          : '智联招聘 · 校园／社招';
  const batchLabel = provider === 'boss' ? '推荐' : '职位';
  const endpoint = `/api/platforms/${provider}`;
  const [state, setState] = useState(initial);
  const [portFile, setPortFile] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [readError, setReadError] = useState(false);
  const [fieldError, setFieldError] = useState<'portFile' | null>(null);
  const portInput = useRef<HTMLInputElement>(null);
  const intent = useRef<{ command: BossCommand; idempotencyToken: string } | null>(null);
  const submitting = useRef(false);
  const lifetime = useRef<AbortController | null>(null);
  const mutationVersion = useRef(0);
  const refreshedTask = useRef(initial.task?.id);
  const generation = state.connection?.generation;
  const progress = state.task?.progress;
  const stageLabels = {
    connect: '连接初始化',
    list: '读取列表',
    detail: '校验详情',
    save: '保存职位',
    complete: '批次完成',
  };
  const active = state.task?.status === 'pending' || state.task?.status === 'running';
  const usable =
    state.connection?.status === 'connected' || state.connection?.status === 'available';
  const disabled = busy || active || readError || intent.current !== null;
  const frozen =
    !usable &&
    !!generation &&
    (state.connection?.status === 'access_blocked' ||
      state.connection?.status === 'rate_limited' ||
      (state.connection?.status === 'unavailable' && progress?.stage !== 'connect'));
  const website = {
    boss: 'https://www.zhipin.com/web/geek/jobs',
    zhilian: 'https://www.zhaopin.com/jobs',
    '51job': 'https://we.51job.com/pc/search',
    liepin: 'https://c.liepin.com/',
  }[provider];

  useEffect(() => {
    // 1、只在新任务终态刷新本地职位列表，失败已入库部分同样可见；绝不自动采集。
    if (placement !== 'jobs' || !state.task || active || state.task.id === refreshedTask.current)
      return;
    refreshedTask.current = state.task.id;
    router.refresh();
  }, [placement, state.task, active, router]);

  useEffect(() => {
    // 1、串行轮询本地数据库；卸载中止请求，不自动触发采集或连接。
    const controller = new AbortController();
    lifetime.current = controller;
    let timer: ReturnType<typeof setTimeout>;
    let refreshing = false;
    const cancelled = (): boolean => controller.signal.aborted;
    const hidden = (): boolean => document.hidden;
    const refresh = async (): Promise<void> => {
      if (hidden() || cancelled() || refreshing) return;
      clearTimeout(timer);
      refreshing = true;
      const version = mutationVersion.current;
      try {
        const response = await fetch(endpoint, {
          cache: 'no-store',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
        });
        if (!response.ok) throw new Error('state unavailable');
        const result = (await response.json()) as { data: WebBossSnapshot };
        if (!cancelled() && version === mutationVersion.current && !submitting.current) {
          setState(result.data);
          setReadError(false);
        }
      } catch {
        if (!cancelled()) setReadError(true);
      } finally {
        refreshing = false;
        if (!cancelled() && !hidden()) timer = setTimeout(() => void refresh(), 3000);
      }
    };
    const visible = (): void => {
      clearTimeout(timer);
      if (!document.hidden) void refresh();
    };
    document.addEventListener('visibilitychange', visible);
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [endpoint]);

  /** 提交结果不明时保留同一令牌，恢复确认不能重复创建任务。 */
  const submit = async (command?: BossCommand): Promise<void> => {
    if (submitting.current) return;
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted) return;
    const cancelled = (): boolean => signal.aborted;
    submitting.current = true;
    mutationVersion.current++;
    setBusy(true);
    setError('');
    // 2、只有新的明确操作才生成令牌；网络失败后的确认复用旧输入。
    intent.current ??= command ? { command, idempotencyToken: crypto.randomUUID() } : null;
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: await mutationHeaders(),
        body: JSON.stringify(intent.current),
        signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
      });
      const result = (await response.json()) as {
        data?: { taskId: string };
        error?: { message: string };
      };
      if (cancelled()) return;
      if (response.status === 400 || response.status === 403) {
        intent.current = null;
        setError(result.error?.message ?? '请求无效，请检查输入。');
        return;
      }
      if (!response.ok || !result.data) throw new Error(result.error?.message ?? '提交结果未知。');
      intent.current = null;
      const taskId = result.data.taskId;
      mutationVersion.current++;
      setState((previous) => ({
        ...previous,
        task: { id: taskId, status: 'pending', error: null },
      }));
    } catch {
      if (!cancelled()) setError('未能确认提交结果。请使用“确认上次提交”，不会重复创建任务。');
    } finally {
      submitting.current = false;
      if (!cancelled()) setBusy(false);
    }
  };

  /** 显式同意后发布连接动作，不从浏览器配置目录扫描凭据。 */
  const connect = (event: SyntheticEvent<HTMLFormElement>): void => {
    event.preventDefault();
    // 3、应用拥有字段校验；错误保留草稿并聚焦首个无效字段。
    if (!/^(\/|[a-zA-Z]:[\\/]).*[/\\]DevToolsActivePort$/.test(portFile.trim())) {
      setFieldError('portFile');
      portInput.current?.focus();
      return;
    }
    setFieldError(null);
    if (consent && !disabled) void submit({ action: 'connect', portFile: portFile.trim() });
  };

  return (
    <section className={styles.workspace} aria-labelledby={`${provider}-title`}>
      <header className={styles.header}>
        <div>
          <h2 id={`${provider}-title`}>{label}</h2>
          <p>每次只读取一批，后台串行补齐本批详情并自动入库。不自动翻页、投递或发消息。</p>
        </div>
        <span
          role="status"
          className={styles.status}
          data-state={usable ? 'available' : (state.connection?.status ?? 'disconnected')}
        >
          {statusLabels[state.connection?.status ?? 'disconnected'] ?? '状态未知'}
        </span>
      </header>
      <p className={styles.guidance}>
        在本机 Chrome 打开并登录{' '}
        <a href={website} target="_blank" rel="noreferrer noopener">
          {label}官网
        </a>
        ，启用远程调试。获取时由 Worker
        新建专用标签页，共享当前配置的登录态，不接管已有页面；后续复用专用页。Chrome
        如提示授权，请点击允许，不需要刷新。
      </p>
      {
        <label className={styles.consent}>
          <input
            type="checkbox"
            checked={consent}
            disabled={disabled}
            onChange={(event) => {
              setConsent(event.target.checked);
            }}
          />
          允许自动连接 Chrome 并创建平台专用页，读取最小登录上下文，仅在 Worker 内存使用，不保存
          Cookie。
          {provider === '51job' ? '连接期间持续观察该页的职位请求，直到断开。' : ''}
        </label>
      }
      <div className={styles.actions}>
        <button
          type="button"
          className="button-primary"
          disabled={disabled || (!usable && !consent) || (usable && state.batch?.hasMore === false)}
          onClick={() =>
            void submit(
              frozen
                ? { action: 'connect' }
                : {
                    action: 'acquire',
                    generation: generation ?? null,
                  },
            )
          }
        >
          {frozen ? '重新连接' : '获取职位'}
        </button>
        {usable && <span>复用当前连接，仅获取一批</span>}
      </div>
      {frozen && (
        <p className={styles.guidance}>
          当前连接已暂停，不会自动重试。请先确认官网状态；重新连接会开始新的查询，已入库职位保留。
        </p>
      )}
      {/* 4、技术参数仅用于自动发现失败时的高级备用，不再是日常获取前置条件。 */}
      <details className={styles.connection}>
        <summary>高级连接设置</summary>
        <p id={`${provider}-help`}>
          默认无需填写。仅在无法自动找到 Chrome 时填写调试描述文件路径；仍由 Worker
          新建专用页，不需要标签页 ID。连接时请在 Chrome 确认授权。同一活动连接内不会逐次授权，重启
          Worker 后需要重新连接。断开连接只关闭 Worker 自己创建的页，不关闭你的其他页面。
          {provider === 'zhilian'
            ? '授权后请在新建的主站搜索页执行一次搜索并打开一条职位详情；初始化最多等待 120 秒，不需要刷新。主站目前支持关键词、城市、经验筛选及默认排序，其他筛选尚未支持。查询随连接固定；官网改动不会同步，切换查询请重新连接。'
            : ''}
          {provider === '51job'
            ? '连接后在专用页正常搜索或翻页，再读取官网批次。只观察专用页的职位请求，不自动翻页；最多等待新批次 90 秒，不自行生成签名。更换查询请重新连接。'
            : ''}
          {provider === 'liepin'
            ? '若新页未产生推荐请求，请在专用页正常切换一次综合／最新排序，初始化最多等待 120 秒，不需要刷新。后续批次和详情通过 HTTP 获取，每次只取一批。查询条件和排序随连接固定，改动后请重新连接；暂不支持社招身份推荐或搜索。'
            : ''}
        </p>
        <form
          noValidate
          onSubmit={connect}
          className={styles.form}
          aria-describedby={`${provider}-help`}
        >
          <label>
            调试描述文件绝对路径
            <input
              ref={portInput}
              aria-invalid={fieldError === 'portFile'}
              aria-describedby={fieldError === 'portFile' ? `${provider}-path-error` : undefined}
              required
              value={portFile}
              onChange={(event) => {
                setPortFile(event.target.value);
              }}
              placeholder="…/DevToolsActivePort"
              disabled={busy || active}
            />
          </label>
          {fieldError === 'portFile' && (
            <p id={`${provider}-path-error`} role="alert">
              请输入以 DevToolsActivePort 结尾的绝对文件路径。
            </p>
          )}
          <button className="button-primary" disabled={disabled || !consent} type="submit">
            {usable ? '重新连接' : '连接 Chrome'}
          </button>
        </form>
      </details>
      <div className={styles.actions}>
        <button
          type="button"
          className="button-secondary"
          disabled={disabled || !generation || state.connection?.status === 'disconnected'}
          onClick={() => {
            if (generation) void submit({ action: 'disconnect', generation });
          }}
        >
          断开连接
        </button>
      </div>
      <p className={styles.guidance}>
        {provider === 'boss'
          ? 'BOSS 当前仅接入推荐流，不提供搜索排序；本次仅处理一批，不遍历全部结果。'
          : '请在 Worker 专用页设置支持的查询条件，不沿用你原页面的筛选；本次仅处理一页，不遍历全部结果。'}
        详情失败或取消会停止后续请求，已入库职位保留；每次网络请求沿用平台连接器的间隔限制。
      </p>
      {provider === 'zhilian' && (
        <p className={styles.guidance}>
          首次连接后请在新建的主站搜索页执行搜索并打开一条详情；初始化最多等待 120 秒。
        </p>
      )}
      {provider === 'liepin' && (
        <p className={styles.guidance}>
          若新页未产生推荐请求，请在 Worker 专用的学生首页切换一次综合／最新排序；初始化最多等待 120
          秒。目前不支持社招首页。
        </p>
      )}
      {provider === '51job' && (
        <p className={styles.guidance}>
          先在 Worker 专用页搜索或翻页，再读取该批。详情使用该批 JSON
          中的完整正文，不额外请求详情接口；自动翻页和长期稳定性尚未验证。
        </p>
      )}
      {state.task && (
        <p role="status" className={styles.taskStatus}>
          {active
            ? progress && progress.stage !== 'connect'
              ? '后台正在处理本批职位，无需刷新官网页面。'
              : provider === 'zhilian'
                ? '后台任务执行中；若为连接任务，请允许 Chrome 授权，并在新建专用页执行主站搜索、打开职位详情。'
                : '后台任务执行中；连接任务可能正在等待 Chrome 授权。'
            : state.task.status === 'succeeded'
              ? '上次操作已完成。'
              : state.task.status === 'cancelled'
                ? '上次操作已取消。'
                : state.task.error}{' '}
          <a href={`/tasks?type=platform.${provider}`}>查看任务{active ? '或取消' : ''}</a>
        </p>
      )}
      {progress && (
        <div className={styles.progress} role="status" aria-live="polite">
          <p>
            本次任务：{stageLabels[progress.stage]}。有效候选 {progress.total ?? '待确定'}{' '}
            条，已处理 {progress.processed} 条，已入库 {progress.saved} 条，排除缺少公司身份{' '}
            {progress.skipped} 条。
          </p>
          {progress.failure && (
            <p className={styles.diagnostic}>
              停止阶段：{stageLabels[progress.stage]}；类别：{progress.failure.category}
              {progress.failure.businessCode !== null
                ? `；业务码：${String(progress.failure.businessCode)}`
                : ''}
              {progress.failure.reason ? `；原因码：${progress.failure.reason}` : ''}
              。已入库职位保留，可在职位页查看。任务编号：<code>{state.task?.id}</code>。
            </p>
          )}
        </div>
      )}
      {readError && (
        <p className={styles.error} role="alert">
          本地状态读取失败，操作暂时禁用；正在重新读取，不会请求招聘平台。
        </p>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}{' '}
          {intent.current && (
            <button
              type="button"
              className="button-secondary"
              disabled={busy || readError}
              onClick={() => void submit()}
            >
              确认上次提交
            </button>
          )}
        </p>
      )}
      {state.batch && (
        <p className={styles.taskStatus}>
          {state.batch.savedCount === undefined
            ? '历史批次未记录自动入库数量，请到职位页查看实际结果。'
            : `最近成功批次已入库 ${String(state.batch.savedCount)} 条职位。`}
          排除缺少公司身份的记录 {state.batch.skippedMissingCompanyId ?? 0} 条。
          {state.batch.hasMore === false ? `已无更多${batchLabel}。` : ''}
        </p>
      )}
      {placement !== 'jobs' && (
        <a className="button-secondary" href={`/jobs?source=platform&provider=${provider}`}>
          查看平台职位
        </a>
      )}
      <p className={styles.note}>
        已保存职位进入统一职位库，可继续使用现有详情和匹配功能。不会因本次结果未出现而标记职位下架。
      </p>
      {placement !== 'jobs' && <PlatformRetentionStatus />}
    </section>
  );
}
