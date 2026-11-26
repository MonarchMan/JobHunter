'use client';

import { useEffect, useRef, useState, type ReactElement, type SyntheticEvent } from 'react';
import type { BossCommand } from '@jobhunter/recruitment/platform-application/platforms';
import type { WebBossSnapshot } from '@jobhunter/recruitment/platform-application/web-platforms';
import { mutationHeaders } from '../../src/client/csrf.js';
import { NavigationLink } from '../components/layout/navigation-pending.js';
import styles from './boss-browser.module.css';
import { Icon } from '../components/ui-icon.js';

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
        ? '前程无忧'
        : provider === 'liepin'
          ? '猎聘'
          : '智联招聘';
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
    // 1、四平台日常动作由 Worker 读取默认资料；页面不复制关键词形成另一份真相。
    if (command?.action === 'connect' || command?.action === 'acquire')
      command = { ...command, profileSearch: true };
    setFieldError(null);
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

  const connectionConsent = (
    <label className={styles.consent}>
      <input
        type="checkbox"
        checked={consent}
        disabled={disabled}
        onChange={(event) => {
          setConsent(event.target.checked);
        }}
      />
      允许自动连接本机 Chrome，创建平台专用页并使用登录态
    </label>
  );

  return (
    <section className={styles.workspace} aria-labelledby={`${provider}-title`}>
      <header className={styles.header}>
        <div className={styles.title}>
          <img
            className={styles.logo}
            src={`/assets/company-logos/${provider}.jpg`}
            alt=""
            width={32}
            height={32}
          />
          <h2 id={`${provider}-title`}>{label}</h2>
          <span
            className={styles.status}
            role="status"
            data-state={usable ? 'available' : state.connection?.status}
          >
            {statusLabels[state.connection?.status ?? 'disconnected']}
          </span>
        </div>
        <a className={styles.link} href={website} target="_blank" rel="noreferrer noopener">
          平台官网 <Icon name="external" size={14} />
        </a>
      </header>
      <div className={styles.body}>
        <div className={styles.fieldHeader}>
          <h3>意向岗位</h3>
        </div>
        <div className={styles.keywords}>
          {state.profileSearch?.keywords.length
            ? state.profileSearch.keywords.map((keyword) => <span key={keyword}>{keyword}</span>)
            : '尚未填写具体岗位'}
        </div>
        {state.profileSearch?.error && (
          <p role="alert" className={styles.error}>
            {state.profileSearch.error}
          </p>
        )}
        {!usable && connectionConsent}
        <div className={styles.actions}>
          <button
            type="button"
            className="button-primary"
            disabled={
              disabled ||
              !!state.profileSearch?.error ||
              (!usable && !consent) ||
              (usable && state.batch?.hasMore === false)
            }
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
          <NavigationLink
            className="button-secondary"
            href={`/jobs?source=platform&provider=${provider}`}
          >
            查看平台职位
          </NavigationLink>
        </div>
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
      </div>
      {(state.task ?? state.batch) && (
        <section className={styles.results} aria-label="采集记录">
          <div className={styles.fieldHeader}>
            <h3>{active ? '本次采集' : '最近记录'}</h3>
            <NavigationLink className={styles.link} href={`/tasks?type=platform.${provider}`}>
              {active ? '查看任务或取消' : '查看任务'} <Icon name="chevronRight" size={14} />
            </NavigationLink>
          </div>
          <div role="status">
            {active && <p>{progress ? stageLabels[progress.stage] : '等待执行'}</p>}
            {state.task?.status === 'cancelled' && <p>任务已取消</p>}
            {state.task?.error && <p className={styles.error}>{state.task.error}</p>}
            {(progress ?? (!active && state.batch)) && (
              <dl className={styles.metrics}>
                <div>
                  <dt>批次</dt>
                  <dd>
                    {progress?.batchNumber ?? '—'}
                    {progress?.batchLimit && <small> / {progress.batchLimit}</small>}
                  </dd>
                </div>
                <div>
                  <dt>已处理</dt>
                  <dd>
                    {progress?.processed ?? '—'}
                    {progress?.total != null && <small> / {progress.total}</small>}
                  </dd>
                </div>
                <div>
                  <dt>
                    {!progress && state.task?.status !== 'succeeded' ? '上次成功入库' : '已入库'}
                  </dt>
                  <dd>{progress?.saved ?? state.batch?.savedCount ?? '—'}</dd>
                </div>
              </dl>
            )}
            {progress && (progress.skipped > 0 || !!progress.skippedPaused) && (
              <p>
                {[
                  progress.skipped > 0 && `缺少公司身份 ${String(progress.skipped)} 条`,
                  !!progress.skippedPaused && `暂停招聘 ${String(progress.skippedPaused)} 条`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}
            {!active && state.batch?.hasMore === false && <p>已到末页</p>}
          </div>
          {progress?.failure && (
            <details className={styles.details}>
              <summary>失败诊断</summary>
              <p>
                停止阶段：{stageLabels[progress.stage]} · 类别：{progress.failure.category}
                {progress.failure.businessCode !== null &&
                  ` · 业务码：${String(progress.failure.businessCode)}`}
                {progress.failure.reason && ` · 原因码：${progress.failure.reason}`}
              </p>
              {progress.currentExternalJobId && (
                <p>
                  职位 ID：<code>{progress.currentExternalJobId}</code>
                </p>
              )}
              {progress.detailStartedAt !== undefined && (
                <p>
                  读取时间：
                  {new Date(progress.detailStartedAt).toLocaleString('zh-CN', {
                    timeZone: 'Asia/Shanghai',
                  })}
                </p>
              )}
              {progress.failure.evidence && (
                <code>{JSON.stringify(progress.failure.evidence)}</code>
              )}
              <p>
                任务编号：<code>{state.task?.id}</code>
              </p>
            </details>
          )}
        </section>
      )}
      <footer className={styles.footer}>
        <details className={styles.details}>
          <summary>高级连接设置</summary>
          {usable && connectionConsent}
          <p id={`${provider}-help`}>自动连接失败时，可指定 Chrome 调试文件。</p>
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
            <button
              className="button-primary"
              disabled={disabled || !consent || !!state.profileSearch?.error}
              type="submit"
            >
              {usable ? '重新连接' : '连接 Chrome'}
            </button>
          </form>
          <div className={styles.actions}>
            {usable && (
              <button
                type="button"
                className="button-secondary"
                disabled={disabled || !!state.profileSearch?.error || !consent}
                onClick={() => void submit({ action: 'connect' })}
              >
                按当前资料重新连接
              </button>
            )}
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
        </details>
      </footer>
    </section>
  );
}
