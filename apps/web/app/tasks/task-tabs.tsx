import type { ReactElement } from 'react';
import styles from './usage.module.css';
/** 任务页的地址化视图切换，刷新及浏览器返回保留当前 tab。 */
export function TaskTabs({ usage = false }: { usage?: boolean }): ReactElement {
  return (
    <nav className={styles.tabs} aria-label="任务视图">
      <a href="/tasks" aria-current={!usage ? 'page' : undefined}>
        任务与运行
      </a>
      <a href="/tasks?tab=usage" aria-current={usage ? 'page' : undefined}>
        用量统计
      </a>
    </nav>
  );
}
