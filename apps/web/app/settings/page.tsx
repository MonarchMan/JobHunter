import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { getWebContainer } from '../../src/server/container.js';
import { PageHeader } from '../components/page-header.js';
import { SettingsForm } from './settings-form.js';
import styles from './settings.module.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '设置' };

export default async function SettingsPage(): Promise<ReactElement> {
  const container = await getWebContainer();
  return (
    <main id="main-content" tabIndex={-1}>
      <PageHeader
        title="设置"
        description="管理影响整个系统的非敏感运行开关。修改会立即保存，下一次同步开始时生效。"
      />
      <section
        className={[styles.settingsPanel, 'panel'].join(' ')}
        aria-labelledby="settings-title"
      >
        <div className={[styles.sectionHeading, 'section-heading'].join(' ')}>
          <h2 id="settings-title">工作流偏好</h2>
          <p className="muted">设置同步范围、自动匹配和职位列表的默认展示方式。</p>
        </div>
        <SettingsForm settings={container.services.settings.get()} />
      </section>
    </main>
  );
}
