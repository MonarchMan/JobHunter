'use client';

import { useRouter, useSearchParams } from 'next/navigation.js';
import { useTransition, type ReactElement } from 'react';
import { SelectField } from '../components/forms/select-field.js';
import { platformOptions } from '../components/forms/platform-options.js';

/** 来源切换只查询本地职位；重置不适用于新来源的类别、公司和分页。 */
export function JobSourceFilter({
  field,
  value,
}: Readonly<
  { field: 'source'; value: 'official' | 'platform' } | { field: 'provider'; value: string }
>): ReactElement {
  const router = useRouter();
  const parameters = useSearchParams();
  const [pending, startTransition] = useTransition();
  const change = (selection: string): void => {
    // 1、来源是已提交 URL 状态，不因重新渲染触发上游采集。
    const next = new URLSearchParams(parameters.toString());
    for (const name of ['page', 'cursor', 'company']) next.delete(name);
    if (field === 'source') {
      next.delete('category');
      next.delete('provider');
    }
    if (selection) next.set(field, selection);
    else next.delete(field);
    startTransition(() => {
      router.push(`/jobs?${next.toString()}`);
    });
  };
  return (
    <SelectField
      name={field}
      label={field === 'source' ? '来源类型' : '招聘平台'}
      value={value}
      disabled={pending}
      fitOptions={field === 'provider'}
      onValueChange={change}
      options={
        field === 'source'
          ? [
              { value: 'official', label: '官网来源' },
              { value: 'platform', label: '招聘平台' },
            ]
          : [{ value: '', label: '全部平台' }, ...platformOptions]
      }
    />
  );
}
