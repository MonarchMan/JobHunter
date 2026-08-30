import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { getWebContainer } from '../../../src/server/container.js';
import { PageHeader } from '../../components/page-header.js';
import { InterviewSectionNav } from '../interview-section-nav.js';
import { ExperienceIntake } from './experience-intake.js';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '历史面经' };

export default async function ExperiencePage(): Promise<ReactElement> {
  const service = (await getWebContainer()).services.experiences;
  return (
    <main id="main-content" tabIndex={-1}>
      <PageHeader
        eyebrow="PERSONAL INTERVIEW ARCHIVE"
        title="历史面经"
        description="导入或在线记录自己的面试问题与回答。系统先整理成草稿，只有你确认后才进入历史记录。"
      />
      <InterviewSectionNav />
      <ExperienceIntake template={service.template()} documents={service.list()} />
    </main>
  );
}
