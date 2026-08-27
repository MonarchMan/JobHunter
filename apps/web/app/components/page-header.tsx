import type { ReactElement, ReactNode } from 'react';
import styles from './page-header.module.css';

export function PageHeader({
  eyebrow,
  title,
  description,
  children,
}: Readonly<{
  eyebrow: string;
  title: string;
  description?: string;
  children?: ReactNode;
}>): ReactElement {
  return (
    <header className={styles.header}>
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
      </div>
      {children ?? (description ? <p>{description}</p> : null)}
    </header>
  );
}
