import type { ReactElement } from 'react';
import { Icon } from '../ui-icon.js';
import styles from './search-button.module.css';

/** 表单搜索提交入口，图标展示保留可访问名称和悬停提示。 */
export function SearchButton(): ReactElement {
  return (
    <button type="submit" className={styles.searchButton} aria-label="搜索" title="搜索">
      <Icon name="search" size={18} />
    </button>
  );
}
