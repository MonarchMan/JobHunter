import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { getWebContainer } from '../../src/server/container.js';
import { PageHeader } from '../components/page-header.js';
import { SettingsForm } from './settings-form.js';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '设置' };

export default async function SettingsPage(): Promise<ReactElement> {
  const container = await getWebContainer();
  return (
    <main id="main-content" tabIndex={-1}>
      <PageHeader
        eyebrow="SYSTEM SETTINGS"
        title="设置"
        description="管理影响整个系统的非敏感运行开关。修改会立即保存，下一次同步开始时生效。"
      />
      <section className="settings-panel panel" aria-labelledby="settings-title">
        <div className="section-heading">
          <p className="eyebrow">MATCHING</p>
          <h2 id="settings-title">职位理解</h2>
          <p className="muted">
            职位理解会调用模型提取岗位语义信息。关闭后，新同步的职位不会自动创建职位理解任务；已有任务和已有结果不会被删除。
          </p>
        </div>
        <SettingsForm settings={container.services.settings.get()} />
      </section>
    </main>
  );
}
