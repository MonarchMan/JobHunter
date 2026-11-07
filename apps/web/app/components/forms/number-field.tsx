'use client';

import { useRef, useState, type ComponentPropsWithoutRef, type ReactElement } from 'react';
import { Icon } from '../ui-icon.js';
import styles from './number-field.module.css';

/** 保留数值输入的原生约束和表单语义，统一使用可键盘操作的上下调节按钮。 */
export function NumberField({
  label,
  value,
  defaultValue,
  onChange,
  disabled,
  readOnly,
  min,
  max,
  ...properties
}: Omit<ComponentPropsWithoutRef<'input'>, 'type'> & { readonly label: string }): ReactElement {
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(String(defaultValue ?? ''));
  const current = String(value ?? draft);
  const locked = disabled === true || readOnly === true;

  /** 原生 stepUp/stepDown 负责小数精度及范围对齐，input 事件沿用调用方的更新流程。 */
  function adjust(direction: 'up' | 'down'): void {
    const element = input.current;
    if (!element || locked) return;
    const previous = element.value;
    const step = element.step;
    if (step === 'any') element.step = '1';
    if (direction === 'up') element.stepUp();
    else element.stepDown();
    element.step = step;
    const next = element.value;
    if (previous !== next) {
      // 重置 React 的值跟踪后通过原生 setter 写入，让受控和非受控表单都收到 change。
      element.value = previous;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        element,
        next,
      );
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }
    element.focus();
  }

  return (
    <span className={styles.field} data-number-field>
      <input
        {...properties}
        ref={input}
        type="number"
        aria-label={properties['aria-label'] ?? label}
        value={value}
        defaultValue={defaultValue}
        disabled={disabled}
        readOnly={readOnly}
        min={min}
        max={max}
        onChange={(event) => {
          setDraft(event.currentTarget.value);
          onChange?.(event);
        }}
      />
      <span className={styles.controls}>
        <button
          type="button"
          aria-label={`增加${label}`}
          disabled={
            locked || (current !== '' && max !== undefined && Number(current) >= Number(max))
          }
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={() => {
            adjust('up');
          }}
        >
          <Icon name="chevronUp" size={12} />
        </button>
        <button
          type="button"
          aria-label={`减少${label}`}
          disabled={
            locked || (current !== '' && min !== undefined && Number(current) <= Number(min))
          }
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={() => {
            adjust('down');
          }}
        >
          <Icon name="chevronDown" size={12} />
        </button>
      </span>
    </span>
  );
}
