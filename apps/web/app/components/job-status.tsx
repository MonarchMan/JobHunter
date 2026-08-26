import type { ReactElement } from 'react';
import { jobStatusLabels } from './status-labels.js';

export function JobStatus({
  status,
}: Readonly<{ status: keyof typeof jobStatusLabels }>): ReactElement {
  return <span className={`status status-${status}`}>{jobStatusLabels[status]}</span>;
}
