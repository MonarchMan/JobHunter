'use client';

import type { ReactElement } from 'react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { CompanyLogo } from './company-logo.js';

export function CompanyCombobox({ companies, defaultValue = '' }: Readonly<{ companies: readonly string[]; defaultValue?: string }>): ReactElement {
  const rootReference = useRef<HTMLDivElement>(null);
  const inputReference = useRef<HTMLInputElement>(null);
  const listboxId = useId();
  const uniqueCompanies = useMemo(() => [...new Set(companies)].sort((left, right) => left.localeCompare(right, 'zh-CN')), [companies]);
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [composing, setComposing] = useState(false);
  const matches = uniqueCompanies.filter((company) => company.includes(value.trim()));

  useEffect(() => {
    const close = (event: PointerEvent): void => {
      if (event.target instanceof Node && !rootReference.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);

  const choose = (company: string): void => {
    setValue(company);
    setOpen(false);
    inputReference.current?.focus();
  };

  return (
    <div className="company-combobox" ref={rootReference}>
      <div className="company-combobox-control">
        <input
          ref={inputReference}
          name="company"
          role="combobox"
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={open}
          aria-activedescendant={open && matches[activeIndex] ? `${listboxId}-${String(activeIndex)}` : undefined}
          value={value}
          placeholder="选择或输入公司"
          autoComplete="off"
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setValue(event.target.value);
            setActiveIndex(0);
            if (!composing) setOpen(true);
          }}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => {
            setComposing(false);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (composing || event.nativeEvent.isComposing) return;
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setOpen(true);
              setActiveIndex((current) => Math.min(current + 1, Math.max(matches.length - 1, 0)));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActiveIndex((current) => Math.max(current - 1, 0));
            } else if (event.key === 'Enter' && open && matches[activeIndex]) {
              event.preventDefault();
              choose(matches[activeIndex]);
            } else if (event.key === 'Escape') {
              setOpen(false);
            }
          }}
        />
        {value ? (
          <button type="button" className="combobox-clear" aria-label="清除公司" onClick={() => { setValue(''); setOpen(true); inputReference.current?.focus(); }}>×</button>
        ) : null}
        <button type="button" className="combobox-toggle" aria-label={open ? '收起公司选项' : '展开公司选项'} aria-expanded={open} onClick={() => { setOpen((current) => !current); inputReference.current?.focus(); }}>⌄</button>
      </div>
      {open ? (
        <ul id={listboxId} className="company-combobox-list" role="listbox" aria-label="公司选项">
          {matches.length ? matches.map((company, index) => (
            <li id={`${listboxId}-${String(index)}`} role="option" aria-selected={value === company} className={index === activeIndex ? 'is-active' : undefined} key={company} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(company)}>
              <CompanyLogo name={company} size="small" />
              <span>{company}</span>
              {value === company ? <span className="combobox-check" aria-hidden="true">✓</span> : null}
            </li>
          )) : <li className="combobox-empty">没有匹配公司，可保留当前文本筛选</li>}
        </ul>
      ) : null}
    </div>
  );
}
