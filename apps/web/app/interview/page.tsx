import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { getWebContainer } from '../../src/server/container.js';
import { PageHeader } from '../components/layout/page-header.js';
import { InterviewProjectIndex } from './project-index.js';
import { InterviewSectionNav } from './interview-section-nav.js';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '面试准备' };

export default async function InterviewPage(): Promise<ReactElement> {
  const container = await getWebContainer();
  return (
    <main id="main-content" tabIndex={-1}>
      <PageHeader
        title="简历项目拷打"
      />
      <InterviewSectionNav />
      <InterviewProjectIndex
        availableProjects={container.services.interview.listAvailableProjects()}
        dossiers={container.services.interview.listDossiers()}
      />
    </main>
  );
}
