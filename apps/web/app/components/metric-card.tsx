import type { ReactElement, ReactNode } from 'react';

export function MetricCard({
  label,
  value,
  detail,
  href,
  tone = 'primary',
}: Readonly<{
  label: string;
  value: ReactNode;
  detail: string;
  href: string;
  tone?: 'primary' | 'blue' | 'amber' | 'violet';
}>): ReactElement {
  return (
    <a className={`metric-card metric-${tone}`} href={href}>
      <p>{label}</p>
      <strong>{value}</strong>
      <span>{detail}</span>
      <span className="metric-arrow" aria-hidden="true">
        ↗
      </span>
    </a>
  );
}
