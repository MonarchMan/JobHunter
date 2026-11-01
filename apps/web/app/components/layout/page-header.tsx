import type { ReactElement, ReactNode } from 'react';
import styles from './page-header.module.css';

/** 展示页面标题与可选操作区；页面实现说明保留在代码注释中。 */
export function PageHeader({
  title,
  children,
  level = 1,
}: Readonly<{
  title: string;
  children?: ReactNode;
  level?: 1 | 2;
}>): ReactElement {
  const Heading = level === 2 ? 'h2' : 'h1';
  return (
    <header className={styles.header}>
      <div>
        <Heading>{title}</Heading>
      </div>
      {children}
    </header>
  );
}
