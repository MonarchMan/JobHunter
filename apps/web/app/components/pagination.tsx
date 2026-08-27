import type { ReactElement } from 'react';
import styles from './pagination.module.css';

interface PaginationProperties {
  readonly currentPage: number;
  readonly totalPages: number;
  readonly createHref: (page: number) => string;
  readonly label: string;
}

function pageItems(currentPage: number, totalPages: number): readonly (number | 'ellipsis')[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  const pages = new Set<number>([
    1,
    totalPages,
    currentPage - 2,
    currentPage - 1,
    currentPage,
    currentPage + 1,
    currentPage + 2,
  ]);
  const visible = [...pages]
    .filter((page) => page >= 1 && page <= totalPages)
    .sort((a, b) => a - b);
  const result: (number | 'ellipsis')[] = [];
  visible.forEach((page, index) => {
    const previous = visible[index - 1];
    if (previous !== undefined && page - previous > 1) result.push('ellipsis');
    result.push(page);
  });
  return result;
}

export function Pagination({
  currentPage,
  totalPages,
  createHref,
  label,
}: PaginationProperties): ReactElement {
  return (
    <nav className={styles.pagination} aria-label={label}>
      <span className={styles.summary}>
        第 {currentPage} / {totalPages} 页
      </span>
      {pageItems(currentPage, totalPages).map((item, index) =>
        item === 'ellipsis' ? (
          <span className={styles.ellipsis} key={`ellipsis-${String(index)}`} aria-hidden="true">
            …
          </span>
        ) : (
          <a
            className={item === currentPage ? styles.current : undefined}
            href={createHref(item)}
            key={item}
            aria-current={item === currentPage ? 'page' : undefined}
          >
            {item}
          </a>
        ),
      )}
    </nav>
  );
}
