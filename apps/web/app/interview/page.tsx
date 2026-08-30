import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { getWebContainer } from '../../src/server/container.js';
import { PageHeader } from '../components/page-header.js';
import { InterviewProjectIndex } from './project-index.js';
import { InterviewSectionNav } from './interview-section-nav.js';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '面试准备' };

export default async function InterviewPage(): Promise<ReactElement> {
  const container = await getWebContainer();
  return (
    <main id="main-content" tabIndex={-1}>
      <PageHeader
        eyebrow="INTERVIEW PREPARATION"
        title="简历项目拷打"
        description="从简历事实出发，一次回答一个问题，逐步补齐项目理解。系统只提问和给结构指导，不替你作答。"
      />
      <InterviewSectionNav />
      <InterviewProjectIndex
        availableProjects={container.services.interview.listAvailableProjects()}
        dossiers={container.services.interview.listDossiers()}
      />
    </main>
  );
}
