import type { ReactElement } from 'react';

export function TruncatedText({
  value,
  className = '',
  focusable = true,
}: Readonly<{ value: string; className?: string; focusable?: boolean }>): ReactElement {
  return (
    <span
      className={`truncated-text ${className}`.trim()}
      tabIndex={focusable ? 0 : undefined}
      aria-label={value}
      title={value}
    >
      <span className="truncated-text-value" aria-hidden="true">
        {value}
      </span>
      <span className="truncated-text-tooltip" role="tooltip">
        {value}
      </span>
    </span>
  );
}
