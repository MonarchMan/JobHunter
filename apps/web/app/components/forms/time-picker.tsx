'use client';

import { useEffect, useRef, useState, type ReactElement } from 'react';
import styles from './time-picker.module.css';

/** 单个 HH:mm 时间框，支持直接输入和面板选择，提交本地时间而不转换时区。 */
export function TimePicker({
  label,
  value,
  onChange,
  disabled = false,
  name,
}: Readonly<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  name?: string;
}>): ReactElement {
  const [hour = '00', minute = '00'] = value.split(':');
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  useEffect(() => {
    if (!open || disabled) return;
    const outside = (event: PointerEvent): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      input.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    root.current?.querySelectorAll<HTMLElement>('[aria-pressed="true"]').forEach((button) => {
      button.scrollIntoView({ block: 'nearest' });
    });
    root.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus();
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape, true);
    };
  }, [open, disabled]);
  return (
    <div
      ref={root}
      className={styles.picker}
      role="group"
      aria-label={label}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <input
        ref={input}
        name={name}
        aria-label={label}
        value={draft}
        disabled={disabled}
        inputMode="numeric"
        maxLength={5}
        placeholder="HH:mm"
        pattern="([01][0-9]|2[0-3]):[0-5][0-9]"
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          if (/^([01]\d|2[0-3]):[0-5]\d$/.test(next)) onChange(next);
        }}
        onBlur={() => {
          setDraft(value);
        }}
      />
      <button
        className={styles.trigger}
        type="button"
        disabled={disabled}
        aria-label={`选择${label}`}
        aria-expanded={open && !disabled}
        aria-haspopup="dialog"
        onClick={() => {
          setOpen(!open);
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 6v6l4 2" />
        </svg>
      </button>
      {open && !disabled && (
        <div className={styles.panel} role="dialog" aria-label={`选择${label}`}>
          {(['小时', '分钟'] as const).map((part) => (
            <div key={part} className={styles.column}>
              <span>{part}</span>
              <div className={styles.options} role="group" aria-label={part}>
                {Array.from({ length: part === '小时' ? 24 : 60 }, (_, index) => {
                  const text = String(index).padStart(2, '0');
                  return (
                    <button
                      key={text}
                      type="button"
                      aria-pressed={text === (part === '小时' ? hour : minute)}
                      tabIndex={text === (part === '小时' ? hour : minute) ? 0 : -1}
                      onKeyDown={(event) => {
                        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
                        event.preventDefault();
                        const next =
                          event.key === 'ArrowDown'
                            ? event.currentTarget.nextElementSibling
                            : event.currentTarget.previousElementSibling;
                        if (next instanceof HTMLElement) next.focus();
                      }}
                      onClick={() => {
                        onChange(part === '小时' ? `${text}:${minute}` : `${hour}:${text}`);
                        if (part === '分钟') {
                          setOpen(false);
                          input.current?.focus();
                        }
                      }}
                    >
                      {text}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
