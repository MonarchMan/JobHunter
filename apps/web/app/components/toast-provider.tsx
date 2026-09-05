'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import styles from './toast-provider.module.css';

export type ToastTone = 'success' | 'warning' | 'error';

interface ToastEntry {
  readonly id: string;
  readonly message: string;
  readonly tone: ToastTone;
}

interface ToastContextValue {
  readonly showToast: (message: string, tone?: ToastTone) => void;
  readonly showToastAfterReload: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);
const reloadToastStorageKey = 'jobhunter.toast.after-reload';
const durations: Readonly<Record<ToastTone, number>> = {
  success: 3_000,
  warning: 5_000,
  error: 6_000,
};
const symbols: Readonly<Record<ToastTone, string>> = {
  success: '✓',
  warning: '!',
  error: '×',
};

/** 管理单条通知的自动关闭，并在用户交互期间暂停计时。 */
function ToastItem({
  toast,
  dismiss,
}: Readonly<{ toast: ToastEntry; dismiss(): void }>): ReactElement {
  const remaining = useRef(durations[toast.tone]);
  const startedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [closing, setClosing] = useState(false);

  const stop = useCallback((): void => {
    if (timer.current === null) return;
    clearTimeout(timer.current);
    timer.current = null;
    remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current));
  }, []);
  const requestClose = useCallback((): void => {
    if (closing) return;
    stop();
    setClosing(true);
    exitTimer.current = setTimeout(dismiss, 120);
  }, [closing, dismiss, stop]);
  const start = useCallback((): void => {
    if (closing || timer.current !== null) return;
    startedAt.current = Date.now();
    timer.current = setTimeout(requestClose, remaining.current);
  }, [closing, requestClose]);

  useEffect(() => {
    start();
    return stop;
  }, [start, stop]);
  useEffect(
    () => () => {
      if (exitTimer.current !== null) clearTimeout(exitTimer.current);
    },
    [],
  );

  return (
    <div
      className={[styles.toast, styles[toast.tone]].join(' ')}
      data-state={closing ? 'closing' : 'open'}
      role={toast.tone === 'error' ? 'alert' : 'status'}
      onMouseEnter={stop}
      onMouseLeave={start}
      onFocusCapture={stop}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) start();
      }}
    >
      <span className={styles.symbol} aria-hidden="true">
        {symbols[toast.tone]}
      </span>
      <span className={styles.message}>{toast.message}</span>
      <button type="button" className={styles.close} aria-label="关闭通知" onClick={requestClose}>
        ×
      </button>
    </div>
  );
}

/** 为全站短暂操作反馈提供顶部居中的通知容器。 */
export function ToastProvider({ children }: Readonly<{ children: ReactNode }>): ReactElement {
  const [toasts, setToasts] = useState<readonly ToastEntry[]>([]);
  const dismiss = useCallback((id: string): void => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);
  const showToast = useCallback((message: string, tone: ToastTone = 'success'): void => {
    const toast = { id: crypto.randomUUID(), message, tone };
    setToasts((current) =>
      [...current.filter((entry) => entry.message !== message || entry.tone !== tone), toast].slice(
        -3,
      ),
    );
  }, []);
  const showToastAfterReload = useCallback(
    (message: string, tone: ToastTone = 'success'): void => {
      try {
        // 只登记给下一个文档实例，避免在当前页面闪现后又重复通知。
        window.sessionStorage.setItem(reloadToastStorageKey, JSON.stringify({ message, tone }));
      } catch {
        // 隐私模式等环境可能禁用会话存储，此时至少在当前页面展示结果。
        showToast(message, tone);
      }
    },
    [showToast],
  );

  useEffect(() => {
    // 延后到当前 effect 确认挂载后再消费，避免 React 开发模式的预检查挂载提前取走通知。
    const timer = window.setTimeout(() => {
      try {
        // 1、先删除存储值，保证即使内容损坏也不会在后续刷新中反复尝试。
        const serialized = window.sessionStorage.getItem(reloadToastStorageKey);
        if (!serialized) return;
        window.sessionStorage.removeItem(reloadToastStorageKey);
        // 2、会话存储属于外部输入，恢复前严格限制字段类型和通知级别。
        const stored = JSON.parse(serialized) as unknown;
        if (
          typeof stored !== 'object' ||
          stored === null ||
          !('message' in stored) ||
          typeof stored.message !== 'string' ||
          !('tone' in stored) ||
          !['success', 'warning', 'error'].includes(String(stored.tone))
        ) {
          return;
        }
        showToast(stored.message, stored.tone as ToastTone);
      } catch {
        // 会话存储不可用或内容损坏时直接丢弃，不影响页面渲染。
      }
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [showToast]);

  return (
    <ToastContext.Provider value={{ showToast, showToastAfterReload }}>
      {children}
      <div className={styles.viewport} role="region" aria-label="通知">
        {toasts.map((toast) => (
          <ToastItem
            key={toast.id}
            toast={toast}
            dismiss={() => {
              dismiss(toast.id);
            }}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** 返回全局 Toast 发布函数；只能在 ToastProvider 内使用。 */
export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within ToastProvider.');
  return context;
}
