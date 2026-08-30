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
          <h2 id="settings-title">同步范围与职位理解</h2>
          <p className="muted">
            招聘渠道决定系统采集实习、校招或社招中的哪一类岗位。职位理解会调用模型提取岗位语义信息，关闭后不会自动创建新任务。
          </p>
        </div>
        <SettingsForm settings={container.services.settings.get()} />
      </section>
    </main>
  );
}
