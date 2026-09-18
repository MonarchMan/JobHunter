import type { ReactElement, ReactNode } from 'react';
import styles from './page-header.module.css';

export function PageHeader({
  title,
  description,
  children,
}: Readonly<{
  title: string;
  description?: string;
  children?: ReactNode;
}>): ReactElement {
  return (
    <header className={styles.header}>
      <div>
        <h1>{title}</h1>
      </div>
      {children ?? (description ? <p>{description}</p> : null)}
    </header>
  );
}
