'use client';

import type { ReactElement } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import styles from './date-picker.module.css';
import { Icon } from '../ui-icon.js';

interface DatePickerProps {
  readonly label: string;
  readonly name?: string;
  readonly value?: string;
  readonly onChange?: (value: string) => void;
}

const weekdays = ['一', '二', '三', '四', '五', '六', '日'];

/** 把本地日历日期转为不受时区偏移影响的 YYYY-MM-DD 表单值。 */
function formatDate(year: number, month: number, day: number): string {
  return `${String(year)}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** 页面内日期选择器：日历宽度始终跟随输入框，避免原生弹层的浏览器差异。 */
export function DatePicker({ label, name, value, onChange }: DatePickerProps): ReactElement {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [internalValue, setInternalValue] = useState('');
  const [open, setOpen] = useState(false);
  const selected = value ?? internalValue;
  const today = new Date();
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(value ?? '');
    return match
      ? new Date(Number(match[1]), Number(match[2]) - 1, 1)
      : new Date(today.getFullYear(), today.getMonth(), 1);
  });

  useEffect(() => {
    if (!open) return;
    // 1、点击日历外或按 Esc 时收起，避免遮挡后续表单操作。
    const closeOutside = (event: PointerEvent): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false);
        input.current?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  /** 同步受控或非受控表单值，并关闭当前日历。 */
  const choose = (next: string): void => {
    if (value === undefined) setInternalValue(next);
    onChange?.(next);
    setOpen(false);
    // 2、日期按钮随日历关闭而卸载，焦点回到输入框供键盘继续操作。
    queueMicrotask(() => {
      input.current?.focus();
    });
  };

  /** 月份切换使用日历构造器处理跨年，不改变已选择的日期。 */
  const moveMonth = (offset: number): void => {
    setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  };

  /** 输入框与日历图标共用展开行为。 */
  const toggleOpen = (): void => {
    setOpen((current) => !current);
  };

  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const leadingDays = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  return (
    <div className={styles.root} ref={root}>
      <label htmlFor={id}>{label}</label>
      <div className={styles.control}>
        <input
          ref={input}
          id={id}
          name={name}
          value={selected}
          readOnly
          placeholder="选择日期"
          aria-haspopup="dialog"
          onClick={toggleOpen}
        />
        <button
          type="button"
          className={styles.trigger}
          aria-label={`选择${label}`}
          aria-expanded={open}
          onClick={toggleOpen}
        >
          <Icon name="calendar" size={18} />
        </button>
      </div>
      {open ? (
        <div className={styles.calendar} role="dialog" aria-label={`${label}日历`}>
          <div className={styles.monthBar}>
            <button
              type="button"
              aria-label="上个月"
              onClick={() => {
                moveMonth(-1);
              }}
            >
              ‹
            </button>
            <strong>
              {year} 年 {month + 1} 月
            </strong>
            <button
              type="button"
              aria-label="下个月"
              onClick={() => {
                moveMonth(1);
              }}
            >
              ›
            </button>
          </div>
          <div className={styles.days}>
            {weekdays.map((weekday) => (
              <span key={weekday} aria-hidden="true">
                {weekday}
              </span>
            ))}
            {Array.from({ length: leadingDays }, (_, index) => (
              <span key={`empty-${String(index)}`} />
            ))}
            {Array.from({ length: daysInMonth }, (_, index) => {
              const day = index + 1;
              const date = formatDate(year, month, day);
              return (
                <button
                  key={day}
                  type="button"
                  aria-label={date}
                  aria-pressed={selected === date}
                  className={selected === date ? styles.selected : undefined}
                  onClick={() => {
                    choose(date);
                  }}
                >
                  {day}
                </button>
              );
            })}
          </div>
          <div className={styles.actions}>
            <button
              type="button"
              onClick={() => {
                choose('');
              }}
            >
              清除
            </button>
            <button
              type="button"
              onClick={() => {
                setVisibleMonth(new Date(today.getFullYear(), today.getMonth(), 1));
                choose(formatDate(today.getFullYear(), today.getMonth(), today.getDate()));
              }}
            >
              今天
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
