'use client';

import { useRouter, useSearchParams } from 'next/navigation.js';
import { useTransition, type ReactElement } from 'react';
import { SelectField } from '../components/forms/select-field.js';
import styles from './page.module.css';

/** 来源切换只查询本地职位；重置不适用于新来源的类别、公司和分页。 */
export function JobSourceFilter({
  sourceKind,
  providerKey,
}: Readonly<{
  sourceKind: 'official' | 'platform';
  providerKey?: string;
}>): ReactElement {
  const router = useRouter();
  const parameters = useSearchParams();
  const [pending, startTransition] = useTransition();
  const change = (key: 'source' | 'provider', value: string): void => {
    // 1、来源是已提交 URL 状态，不因重新渲染触发上游采集。
    const next = new URLSearchParams(parameters.toString());
    for (const name of ['page', 'cursor', 'company']) next.delete(name);
    if (key === 'source') {
      next.delete('category');
      next.delete('provider');
    }
    if (value) next.set(key, value);
    else next.delete(key);
    startTransition(() => {
      router.push(`/jobs?${next.toString()}`);
    });
  };
  return (
    <section className={styles.filters} aria-label="职位来源" aria-busy={pending}>
      <label>
        来源类型
        <SelectField
          name="source"
          label="来源类型"
          value={sourceKind}
          disabled={pending}
          onValueChange={(value) => {
            change('source', value);
          }}
          options={[
            { value: 'official', label: '官网来源' },
            { value: 'platform', label: '招聘平台' },
          ]}
        />
      </label>
      {sourceKind === 'platform' && (
        <>
          <label>
            招聘平台
            <SelectField
              name="provider"
              label="招聘平台"
              value={providerKey ?? ''}
              disabled={pending}
              onValueChange={(value) => {
                change('provider', value);
              }}
              options={[
                { value: '', label: '全部平台' },
                { value: 'boss', label: 'BOSS 直聘' },
                { value: 'zhilian', label: '智联招聘' },
                { value: '51job', label: '前程无忧' },
                { value: 'liepin', label: '猎聘' },
              ]}
            />
          </label>
          {!providerKey && <p>请选择一个招聘平台，再获取一批职位。</p>}
        </>
      )}
    </section>
  );
}
