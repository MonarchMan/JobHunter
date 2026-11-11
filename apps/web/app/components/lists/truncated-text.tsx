'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import styles from './truncated-text.module.css';

let dismissActiveTooltip: (() => void) | undefined;

/** 文本通过公共悬停提示展示全文或补充信息，不设置 title，避免叠加原生提示。 */
export function TruncatedText({
  value,
  className = '',
  focusable = true,
  tooltip = value,
}: Readonly<{
  value: string;
  className?: string;
  focusable?: boolean;
  tooltip?: string;
}>): ReactElement {
  const root = useRef<HTMLSpanElement>(null);
  const popup = useRef<HTMLSpanElement>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const open = hovered || focused;

  /** 原值和提示面板共用悬停区域，短暂跨越间隙时延迟关闭。 */
  function keepOpen(): void {
    window.clearTimeout(hoverTimer.current);
    setHovered(true);
  }

  function scheduleClose(): void {
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => {
      setHovered(false);
    }, 250);
  }

  useEffect(
    () => () => {
      window.clearTimeout(hoverTimer.current);
    },
    [],
  );

  useEffect(() => {
    // 非独立焦点文本仍需响应外层职位链接的键盘焦点。
    const target = focusable ? root.current : root.current?.closest('a, button');
    if (!target) return;
    const onFocus = (): void => {
      setFocused(target.matches(':focus-visible'));
    };
    const onBlur = (): void => {
      setFocused(false);
    };
    target.addEventListener('focus', onFocus);
    target.addEventListener('blur', onBlur);
    return () => {
      target.removeEventListener('focus', onFocus);
      target.removeEventListener('blur', onBlur);
    };
  }, [focusable]);

  useLayoutEffect(() => {
    const element = popup.current;
    const anchor = root.current;
    if (!open || !element || !anchor) return;

    /** 顶层提示绕开表格 overflow；以原值中心定位，靠近视口边缘时收窄换行。 */
    const position = (): void => {
      const bounds = anchor.getBoundingClientRect();
      const center = bounds.left + bounds.width / 2;
      const available = Math.min(center, window.innerWidth - center) - 12;
      if (available <= 0 || bounds.bottom < 0 || bounds.top > window.innerHeight) {
        if (element.matches(':popover-open')) element.hidePopover();
        return;
      }
      element.style.maxWidth = `${String(Math.min(384, available * 2))}px`;
      if (!element.matches(':popover-open')) element.showPopover();
      const size = element.getBoundingClientRect();
      element.style.left = `${String(center - size.width / 2)}px`;
      const below = bounds.bottom + 7;
      element.style.top = `${String(below + size.height <= window.innerHeight - 12 ? below : Math.max(12, bounds.top - size.height - 7))}px`;
    };
    const dismiss = (): void => {
      window.clearTimeout(hoverTimer.current);
      if (element.matches(':popover-open')) element.hidePopover();
      setHovered(false);
      setFocused(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || dismissActiveTooltip !== dismiss) return;
      // 先关闭提示，避免同一按键同时关闭其所属详情弹窗。
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    };
    // 键盘焦点和鼠标可能位于不同单元格，全页只保留最近打开的提示。
    dismissActiveTooltip?.();
    dismissActiveTooltip = dismiss;
    position();
    const observer = new ResizeObserver(position);
    observer.observe(anchor);
    observer.observe(element);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      if (dismissActiveTooltip === dismiss) dismissActiveTooltip = undefined;
      observer.disconnect();
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
      document.removeEventListener('keydown', onKeyDown, true);
      if (element.matches(':popover-open')) element.hidePopover();
    };
  }, [open, tooltip]);

  return (
    <span
      ref={root}
      className={[styles.root, className].filter(Boolean).join(' ')}
      tabIndex={focusable ? 0 : undefined}
      role="group"
      aria-label={tooltip === value ? value : `${value}，${tooltip}`}
      onPointerEnter={(event) => {
        if (event.pointerType === 'touch') return;
        if (open) {
          keepOpen();
          return;
        }
        window.clearTimeout(hoverTimer.current);
        hoverTimer.current = window.setTimeout(() => {
          setHovered(true);
        }, 1000);
      }}
      onPointerLeave={scheduleClose}
    >
      <span className={styles.value} aria-hidden="true">
        {value}
      </span>
      {open ? (
        <span
          ref={popup}
          popover="manual"
          className={styles.tooltip}
          role="tooltip"
          onPointerEnter={(event) => {
            if (event.pointerType !== 'touch') keepOpen();
          }}
          onPointerLeave={scheduleClose}
          onClick={(event) => {
            // 提示内允许选择、复制文本，点击不能触发表格行弹窗或外层职位链接。
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          {tooltip}
        </span>
      ) : null}
    </span>
  );
}
