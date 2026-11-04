import type { ReactElement } from 'react';
import styles from './truncated-text.module.css';

/** 截断文本通过项目提示展示全文，不设置 title，避免叠加浏览器原生提示。 */
export function TruncatedText({
  value,
  className = '',
  focusable = true,
}: Readonly<{ value: string; className?: string; focusable?: boolean }>): ReactElement {
  return (
    <span
      className={[styles.root, className].filter(Boolean).join(' ')}
      tabIndex={focusable ? 0 : undefined}
      aria-label={value}
    >
      <span className={styles.value} aria-hidden="true">
        {value}
      </span>
      <span className={styles.tooltip} role="tooltip">
        {value}
      </span>
    </span>
  );
}
