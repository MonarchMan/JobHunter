import type { ReactElement, ReactNode } from 'react';
import { NavigationLink } from '../components/layout/navigation-pending.js';
import styles from './metric-card.module.css';

const toneClasses = {
  primary: styles.primary,
  blue: styles.blue,
  amber: styles.amber,
  violet: styles.violet,
} as const;

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
    <NavigationLink className={[styles.card, toneClasses[tone]].join(' ')} href={href}>
      <p>{label}</p>
      <strong>{value}</strong>
      <span>{detail}</span>
    </NavigationLink>
  );
}
