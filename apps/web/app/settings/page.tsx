import type { Metadata } from 'next';
import { Suspense, type ReactElement } from 'react';
import { getWebContainer } from '../../src/server/container.js';
import { browserTestRenderDelay } from '../../src/server/browser-test-render-delay.js';
import { PageHeader } from '../components/layout/page-header.js';
import { SectionLoading } from '../components/layout/section-loading.js';
import { SettingsForm } from './settings-form.js';
import { MailboxSettings } from './mailbox-settings.js';
import styles from './settings.module.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '设置' };
/** 设置保存成功后对后续同步生效，页面只编辑非敏感运行开关。 */
export default function SettingsPage(): ReactElement {
  return (
    <main id="main-content" tabIndex={-1}>
      <PageHeader title="设置" />
      <div className={styles.layout}>
        <section
          className={[styles.settingsPanel, 'panel'].join(' ')}
          aria-labelledby="settings-title"
        >
          <div className={[styles.sectionHeading, 'section-heading'].join(' ')}>
            <h2 id="settings-title">工作流偏好</h2>
          </div>
          <Suspense fallback={<SectionLoading label="正在加载工作流偏好" />}>
            <WorkflowSettings />
          </Suspense>
        </section>
        <section
          className={[styles.settingsPanel, 'panel'].join(' ')}
          aria-labelledby="mailbox-title"
        >
          <Suspense
            fallback={
              <>
                <div className={[styles.sectionHeading, 'section-heading'].join(' ')}>
                  <h2 id="mailbox-title">邮箱连接</h2>
                </div>
                <SectionLoading label="正在加载邮箱连接" />
              </>
            }
          >
            <MailboxSection />
          </Suspense>
        </section>
      </div>
    </main>
  );
}

/** 工作流偏好不等待邮箱状态。 */
async function WorkflowSettings(): Promise<ReactElement> {
  const container = await getWebContainer();
  return <SettingsForm settings={container.services.settings.get()} />;
}

/** 邮箱快照独立加载，不阻塞其他设置。 */
async function MailboxSection(): Promise<ReactElement> {
  await browserTestRenderDelay('mailbox');
  const container = await getWebContainer();
  return (
    <MailboxSettings
      initial={await container.services.mailboxes.snapshot()}
      oauthAvailability={{
        gmail: container.mailOAuth.gmail !== null,
        microsoftGraph: container.mailOAuth.microsoftGraph !== null,
      }}
    />
  );
}
