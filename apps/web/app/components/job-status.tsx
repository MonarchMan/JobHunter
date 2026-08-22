import type { ReactElement } from 'react';

const labels = { active: '在招', stale: '待确认', closed: '已关闭' } as const;

export function JobStatus({ status }: Readonly<{ status: keyof typeof labels }>): ReactElement {
  return <span className={`status status-${status}`}>{labels[status]}</span>;
}
