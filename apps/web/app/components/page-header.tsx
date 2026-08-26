import type { ReactElement, ReactNode } from 'react';

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
    <header className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
      </div>
      {children ?? (description ? <p>{description}</p> : null)}
    </header>
  );
}
