import type { ReactElement } from 'react';
import styles from './section-loading.module.css';

/** 让等待中的数据区与空结果区分，并保留后续内容的空间。 */
export function SectionLoading({ label }: Readonly<{ label: string }>): ReactElement {
  return (
    <div className={styles.region} role="status" aria-label={label} aria-busy="true">
      <div className={styles.placeholder} aria-hidden="true" />
    </div>
  );
}
