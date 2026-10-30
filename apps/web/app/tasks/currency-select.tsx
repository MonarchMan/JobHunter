'use client';

import type { ReactElement } from 'react';
import { SelectField } from '../components/forms/select-field.js';
import styles from './page.module.css';

/** Agent 成本展示币种选择器；选择后立即导航并保留当前筛选条件。 */
export function CurrencySelect({
  value,
  hrefs,
}: Readonly<{
  value: 'USD' | 'CNY';
  hrefs: Readonly<Record<'USD' | 'CNY', string>>;
}>): ReactElement {
  return (
    <div className={styles.currencyPicker}>
      <SelectField
        name="currency"
        label="成本币种"
        value={value}
        options={[
          { value: 'USD', label: 'USD / $' },
          { value: 'CNY', label: 'CNY / ¥' },
        ]}
        onValueChange={(nextValue) => {
          if (nextValue === 'USD' || nextValue === 'CNY') window.location.assign(hrefs[nextValue]);
        }}
      />
    </div>
  );
}
