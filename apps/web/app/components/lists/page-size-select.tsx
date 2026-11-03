'use client';

import type { ReactElement } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation.js';
import { SelectField } from '../forms/select-field.js';
import styles from './pagination.module.css';

/** 修改当前列表的数量与页码，保留筛选和其他列表的分页状态。 */
export function PageSizeSelect({
  pageSize,
  pageParameter,
  sizeParameter,
  label,
}: Readonly<{
  pageSize: number;
  pageParameter: string;
  sizeParameter: string;
  label: string;
}>): ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  return (
    <div className={styles.pageSize}>
      <SelectField
        name={sizeParameter}
        label={`${label}每页数量`}
        value={String(pageSize)}
        options={[10, 20, 50, 100].map((size) => ({
          value: String(size),
          label: `${String(size)} 条/页`,
        }))}
        onValueChange={(value) => {
          const query = new URLSearchParams(search.toString());
          query.set(sizeParameter, value);
          query.delete(pageParameter);
          query.delete('cursor');
          router.push(`${pathname}?${query.toString()}`, { scroll: false });
        }}
      />
    </div>
  );
}
