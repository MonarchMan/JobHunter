import type { ReactElement, ReactNode } from 'react';
import styles from './page-header.module.css';

/** 展示页面标题与可选操作区；页面实现说明保留在代码注释中。 */
export function PageHeader({
  title,
  children,
}: Readonly<{
  title: string;
  children?: ReactNode;
}>): ReactElement {
  return (
    <header className={styles.header}>
      <div>
        <h1>{title}</h1>
      </div>
      {children}
    </header>
  );
}
