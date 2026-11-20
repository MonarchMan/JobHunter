'use client';

import type { ReactElement } from 'react';
import { useRouter } from 'next/navigation.js';
import type { PlatformProviderKey } from '@jobhunter/recruitment/platform-contracts';
import { SelectField } from '../components/forms/select-field.js';
import styles from './source-tabs.module.css';

const options = (
  [
    ['boss', 'BOSS 直聘'],
    ['zhilian', '智联招聘'],
    ['51job', '前程无忧'],
    ['liepin', '猎聘'],
  ] as const
).map(([value, label]) => ({ value, label, iconSrc: `/assets/company-logos/${value}.jpg` }));

/** 平台选择跟随当前路由；切换只加载所选平台的本地状态。 */
export function PlatformSelect({ active }: { readonly active: PlatformProviderKey }): ReactElement {
  const router = useRouter();
  return (
    <div className={styles.selector}>
      <SelectField
        name="provider"
        label="招聘平台选择"
        value={active}
        options={options}
        onValueChange={(provider) => {
          router.push(`/sources?channel=platform&provider=${provider}`, { scroll: false });
        }}
      />
    </div>
  );
}
