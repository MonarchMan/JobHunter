'use client';

import type { ReactElement } from 'react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { CompanyLogo } from './company-logo.js';
import styles from './company-combobox.module.css';

export function CompanyCombobox({
  companies,
  defaultValue = '',
}: Readonly<{ companies: readonly string[]; defaultValue?: string }>): ReactElement {
  const rootReference = useRef<HTMLDivElement>(null);
  const inputReference = useRef<HTMLInputElement>(null);
  const listboxId = useId();
  const uniqueCompanies = useMemo(
    () => [...new Set(companies)].sort((left, right) => left.localeCompare(right, 'zh-CN')),
    [companies],
  );
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [composing, setComposing] = useState(false);
  const matches = uniqueCompanies.filter((company) => company.includes(value.trim()));

  useEffect(() => {
    const close = (event: PointerEvent): void => {
      if (event.target instanceof Node && !rootReference.current?.contains(event.target))
        setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
    };
  }, []);

  const choose = (company: string): void => {
    setValue(company);
    setOpen(false);
    inputReference.current?.focus();
  };

  return (
    <div className={styles.combobox} ref={rootReference}>
      <div className={styles.control}>
        <input
          ref={inputReference}
          name="company"
          role="combobox"
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={open}
          aria-activedescendant={
            open && matches[activeIndex] ? `${listboxId}-${String(activeIndex)}` : undefined
          }
          value={value}
          placeholder="选择或输入公司"
          autoComplete="off"
          onFocus={() => {
            setOpen(true);
          }}
          onChange={(event) => {
            setValue(event.target.value);
            setActiveIndex(0);
            if (!composing) setOpen(true);
          }}
          onCompositionStart={() => {
            setComposing(true);
          }}
          onCompositionEnd={() => {
            setComposing(false);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (composing || event.nativeEvent.isComposing) return;
            switch (event.key) {
              case 'ArrowDown':
                event.preventDefault();
                setOpen(true);
                setActiveIndex((current) => Math.min(current + 1, Math.max(matches.length - 1, 0)));
                break;
              case 'ArrowUp':
                event.preventDefault();
                setActiveIndex((current) => Math.max(current - 1, 0));
                break;
              case 'Enter':
                if (open && matches[activeIndex]) {
                  event.preventDefault();
                  choose(matches[activeIndex]);
                }
                break;
              case 'Escape':
                setOpen(false);
                break;
            }
          }}
        />
        {value ? (
          <button
            type="button"
            className={styles.clear}
            aria-label="清除公司"
            onClick={() => {
              setValue('');
              setOpen(true);
              inputReference.current?.focus();
            }}
          >
            ×
          </button>
        ) : null}
        <button
          type="button"
          className={styles.toggle}
          aria-label={open ? '收起公司选项' : '展开公司选项'}
          aria-expanded={open}
          onClick={() => {
            setOpen((current) => !current);
            inputReference.current?.focus();
          }}
        >
          ⌄
        </button>
      </div>
      {open ? (
        <ul id={listboxId} className={styles.list} role="listbox" aria-label="公司选项">
          {matches.length ? (
            matches.map((company, index) => (
              <li
                id={`${listboxId}-${String(index)}`}
                role="option"
                aria-selected={value === company}
                className={index === activeIndex ? styles.active : undefined}
                key={company}
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
                onClick={() => {
                  choose(company);
                }}
              >
                <CompanyLogo name={company} size="small" />
                <span>{company}</span>
                {value === company ? (
                  <span className={styles.check} aria-hidden="true">
                    ✓
                  </span>
                ) : null}
              </li>
            ))
          ) : (
            <li className={styles.empty}>没有匹配公司，可保留当前文本筛选</li>
          )}
        </ul>
      ) : null}
    </div>
  );
}
