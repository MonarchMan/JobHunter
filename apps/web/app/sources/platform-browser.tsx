'use client';
import { PlatformRetentionStatus } from './platform-retention-status.js';

import { useEffect, useRef, useState, type ReactElement, type SyntheticEvent } from 'react';
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
}: {
  readonly initial: WebBossSnapshot;
  readonly provider: 'boss' | 'zhilian' | '51job' | 'liepin';
}): ReactElement {
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
  const [targetId, setTargetId] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [readError, setReadError] = useState(false);
  const [fieldError, setFieldError] = useState<'portFile' | 'targetId' | null>(null);
  const portInput = useRef<HTMLInputElement>(null);
  const targetInput = useRef<HTMLInputElement>(null);
  const intent = useRef<{ command: BossCommand; idempotencyToken: string } | null>(null);
  const submitting = useRef(false);
  const lifetime = useRef<AbortController | null>(null);
  const generation = state.connection?.generation;
  const active = state.task?.status === 'pending' || state.task?.status === 'running';
  const usable =
    state.connection?.status === 'connected' || state.connection?.status === 'available';
  const disabled = busy || active || readError || intent.current !== null;

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
      try {
        const response = await fetch(endpoint, {
          cache: 'no-store',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
        });
        if (!response.ok) throw new Error('state unavailable');
        const result = (await response.json()) as { data: WebBossSnapshot };
        if (!cancelled()) {
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
    if (!/^[\w-]{1,128}$/.test(targetId.trim())) {
      setFieldError('targetId');
      targetInput.current?.focus();
      return;
    }
    setFieldError(null);
    if (consent && !disabled)
      void submit({ action: 'connect', portFile: portFile.trim(), targetId: targetId.trim() });
  };

  return (
    <section className={styles.workspace} aria-labelledby={`${provider}-title`}>
      <header className={styles.header}>
        <div>
          <h2 id={`${provider}-title`}>{label}</h2>
          <p>每次只读取一批，后台串行补齐本批详情并自动入库。不自动翻页、投递或发消息。</p>
        </div>
        <span role="status">
          {statusLabels[state.connection?.status ?? 'disconnected'] ?? '状态未知'}
        </span>
      </header>
      <details open={!usable} className={styles.connection}>
        <summary>连接已登录的 Chrome</summary>
        <p id={`${provider}-help`}>
          先在 Chrome 打开
          {provider === 'boss'
            ? ' BOSS 推荐页'
            : provider === '51job'
              ? '前程无忧搜索页'
              : provider === 'liepin'
                ? '猎聘学生身份首页（c.liepin.com）'
                : '智联校园推荐页或主站搜索页'}
          并完成登录。填写启用远程调试后产生的描述文件路径和目标标签页 ID；连接时请在 Chrome
          确认授权。同一活动连接内不会逐次授权，重启 Worker 后需要重新连接。
          {provider === 'zhilian'
            ? '授权后请在校园页切换一次分类，或在主站搜索页执行一次搜索并打开一条职位详情；初始化最多等待 120 秒，不需要刷新。主站目前支持关键词、城市、经验筛选及默认排序，其他筛选尚未支持。查询随连接固定；官网改动不会同步，切换查询请重新连接。'
            : ''}
          {provider === '51job'
            ? '连接后在官网正常搜索或翻页，再读取官网批次。只观察所选页的职位请求，不自动操作浏览器；最多等待新批次 90 秒，不自行生成签名。更换查询请重新连接。'
            : ''}
          {provider === 'liepin'
            ? '授权后请正常切换一次综合／最新排序，初始化最多等待 120 秒，不需要刷新。后续批次和详情通过 HTTP 获取，每次只取一批。查询条件和排序随连接固定，改动后请重新连接；暂不支持社招身份推荐或搜索。'
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
          <label>
            目标标签页 ID
            <input
              ref={targetInput}
              aria-invalid={fieldError === 'targetId'}
              aria-describedby={fieldError === 'targetId' ? `${provider}-target-error` : undefined}
              required
              value={targetId}
              onChange={(event) => {
                setTargetId(event.target.value);
              }}
              autoComplete="off"
              disabled={busy || active}
            />
          </label>
          {fieldError === 'targetId' && (
            <p id={`${provider}-target-error`} role="alert">
              请输入有效目标页 ID（字母、数字、下划线或连字符，最多 128 字符）。
            </p>
          )}
          <label className={styles.consent}>
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => {
                setConsent(event.target.checked);
              }}
              disabled={busy || active}
            />
            允许读取所选
            {provider === 'boss'
              ? ' BOSS '
              : provider === '51job'
                ? '前程无忧搜索'
                : provider === 'liepin'
                  ? '猎聘'
                  : '智联'}
            页的最小登录上下文，仅在 Worker 内存使用；不保存 Cookie。
            {provider === '51job' ? '允许在活动连接期间持续观察该页的职位请求，直到断开。' : ''}
          </label>
          <button className="button-primary" disabled={disabled || !consent} type="submit">
            {usable ? '重新连接' : '连接 Chrome'}
          </button>
        </form>
      </details>
      <div className={styles.actions}>
        <button
          type="button"
          className="button-primary"
          disabled={disabled || !usable || state.batch?.hasMore === false}
          onClick={() => {
            if (generation) void submit({ action: 'next', generation });
          }}
        >
          {provider === '51job' ? '读取官网批次' : `读取下一批${batchLabel}`}
        </button>
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
      <p>
        获取前请在官网设置搜索条件及支持的排序；本次仅处理一页，不遍历全部结果。
        {provider === 'boss' ? 'BOSS 当前仅接入推荐流，不提供搜索排序。' : ''}
        详情失败或取消会停止后续请求，已入库职位保留；每次网络请求沿用平台连接器的间隔限制。
      </p>
      {provider === '51job' && (
        <p>
          先在官网搜索或翻页，再读取该批。详情使用该批 JSON
          中的完整正文，不额外请求详情接口；自动翻页和长期稳定性尚未验证。
        </p>
      )}
      {state.task && (
        <p role="status">
          {active
            ? provider === 'zhilian'
              ? '后台任务执行中；若为连接任务，请允许 Chrome 授权，并在所选页切换校园分类或执行主站搜索、打开职位详情。'
              : '后台任务执行中；连接任务可能正在等待 Chrome 授权。'
            : state.task.status === 'succeeded'
              ? '上次操作已完成。'
              : state.task.status === 'cancelled'
                ? '上次操作已取消。'
                : state.task.error}{' '}
          <a href={`/tasks?type=platform.${provider}`}>查看任务{active ? '或取消' : ''}</a>
        </p>
      )}
      {readError && (
        <p role="alert">本地状态读取失败，操作暂时禁用；正在重新读取，不会请求招聘平台。</p>
      )}
      {error && (
        <p role="alert">
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
        <p>
          {state.batch.savedCount === undefined
            ? '历史批次未记录自动入库数量，请到职位页查看实际结果。'
            : `最近成功批次已入库 ${String(state.batch.savedCount)} 条职位。`}
          排除缺少公司身份的记录 {state.batch.skippedMissingCompanyId ?? 0} 条。
          {state.batch.hasMore === false ? `已无更多${batchLabel}。` : ''}
        </p>
      )}
      <a className="button-secondary" href={`/jobs?source=platform&provider=${provider}`}>
        查看平台职位
      </a>
      <p className={styles.note}>
        已保存职位进入统一职位库，可继续使用现有详情和匹配功能。不会因本次结果未出现而标记职位下架。
      </p>
      <PlatformRetentionStatus />
    </section>
  );
}
