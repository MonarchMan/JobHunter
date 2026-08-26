'use client';

import type { ReactElement } from 'react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { mutationHeaders } from '../../src/client/csrf.js';
import { Icon } from './ui-icon.js';

export function JobScoreAction({
  jobIds,
  profileVersionId,
  label = '评分',
  showHint = false,
}: Readonly<{
  jobIds: readonly string[];
  profileVersionId: string | undefined;
  label?: string;
  showHint?: boolean;
}>): ReactElement {
  const triggerReference = useRef<HTMLButtonElement>(null);
  const panelReference = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const unavailableReason = !profileVersionId
    ? '请先导入或选择个人资料'
    : jobIds.length === 0
      ? '请先选择职位'
      : null;

  const score = async (mode: 'rules' | 'llm'): Promise<void> => {
    if (unavailableReason) return;
    setBusy(true);
    setMessage(null);
    setOpen(false);
    try {
      const bulk = jobIds.length > 1;
      const response = await fetch(
        bulk ? '/api/jobs/match' : `/api/jobs/${jobIds[0] ?? ''}/match`,
        {
          method: 'POST',
          headers: await mutationHeaders(),
          body: JSON.stringify({
            ...(bulk ? { jobIds } : {}),
            profileVersionId,
            idempotencyToken: crypto.randomUUID(),
            mode,
          }),
        },
      );
      const body = (await response.json()) as { readonly error?: { readonly message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? '评分任务创建失败。');
      setMessage(
        `已为 ${String(jobIds.length)} 个职位创建${mode === 'llm' ? ' LLM 深度' : '规则'}评分任务。`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '评分任务创建失败。');
    } finally {
      setBusy(false);
    }
  };

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerReference.current;
    const panel = panelReference.current;
    if (!trigger || !panel) return;
    const triggerBox = trigger.getBoundingClientRect();
    const panelBox = panel.getBoundingClientRect();
    const gap = 10;
    const margin = 12;
    const preferredLeft = triggerBox.right + gap;
    const left =
      preferredLeft + panelBox.width <= window.innerWidth - margin
        ? preferredLeft
        : Math.max(margin, triggerBox.left - panelBox.width - gap);
    const top = Math.min(
      Math.max(margin, triggerBox.top),
      Math.max(margin, window.innerHeight - panelBox.height - margin),
    );
    setPosition({ left, top });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOnPointer = (event: PointerEvent): void => {
      const target = event.target;
      if (
        target instanceof Node &&
        !triggerReference.current?.contains(target) &&
        !panelReference.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const closeOnKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerReference.current?.focus();
      }
    };
    const closeOnViewportChange = (): void => {
      setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnPointer);
    document.addEventListener('keydown', closeOnKey);
    window.addEventListener('resize', closeOnViewportChange);
    window.addEventListener('scroll', closeOnViewportChange, true);
    return () => {
      document.removeEventListener('pointerdown', closeOnPointer);
      document.removeEventListener('keydown', closeOnKey);
      window.removeEventListener('resize', closeOnViewportChange);
      window.removeEventListener('scroll', closeOnViewportChange, true);
    };
  }, [open]);

  return (
    <div className="score-action">
      {unavailableReason ? (
        <button
          type="button"
          className="button-secondary score-trigger"
          disabled
          title={unavailableReason}
        >
          <Icon name="score" />
          {label}
        </button>
      ) : (
        <>
          <button
            ref={triggerReference}
            type="button"
            className={`button-secondary score-trigger${busy ? ' is-busy' : ''}`}
            aria-expanded={open}
            aria-controls={panelId}
            aria-haspopup="dialog"
            disabled={busy}
            onClick={() => {
              setOpen((current) => !current);
            }}
          >
            <Icon name="score" />
            {busy ? '提交中…' : label}
          </button>
          {open && typeof document !== 'undefined'
            ? createPortal(
                <div
                  ref={panelReference}
                  id={panelId}
                  className="score-menu-panel score-menu-popover"
                  role="dialog"
                  aria-label="选择评分方式"
                  style={{ left: position.left, top: position.top }}
                >
                  <button type="button" onClick={() => void score('rules')} disabled={busy}>
                    <Icon name="rules" size={20} />
                    <span>
                      <strong>规则评分</strong>
                      <small>快速生成可解释的确定性分数</small>
                    </span>
                  </button>
                  <button type="button" onClick={() => void score('llm')} disabled={busy}>
                    <Icon name="sparkles" size={20} />
                    <span>
                      <strong>LLM 深度评分</strong>
                      <small>职位理解、规则评分与求职建议</small>
                    </span>
                  </button>
                </div>,
                document.body,
              )
            : null}
        </>
      )}
      {showHint && unavailableReason ? (
        <span className="action-hint">{unavailableReason}</span>
      ) : null}
      {message ? (
        <span className="action-feedback" role="status">
          {message}
        </span>
      ) : null}
    </div>
  );
}
