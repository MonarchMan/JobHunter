import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { getWebContainer } from '../../../src/server/container.js';
import { PageHeader } from '../../components/layout/page-header.js';
import { InterviewSectionNav } from '../interview-section-nav.js';
import { ExperienceIntake } from './experience-intake.js';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '历史面经' };
/** 导入和在线录入先生成草稿，经用户确认后才进入历史记录。 */
export default async function ExperiencePage(): Promise<ReactElement> {
  const service = (await getWebContainer()).services.experiences;
  return (
    <main id="main-content" tabIndex={-1}>
      <PageHeader title="历史面经" />
      <InterviewSectionNav />
      <ExperienceIntake template={service.template()} documents={service.list()} />
    </main>
  );
}
