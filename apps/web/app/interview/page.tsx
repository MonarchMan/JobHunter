import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { getWebContainer } from '../../src/server/container.js';
import { PageHeader } from '../components/layout/page-header.js';
import { AiConversations } from './ai-conversations.js';
import { InterviewSectionNav } from './interview-section-nav.js';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '面试准备' };

export default async function InterviewPage(): Promise<ReactElement> {
  const container = await getWebContainer();
  return (
    <main id="main-content" tabIndex={-1}>
      <PageHeader title="AI 对话与模拟面试" />
      <InterviewSectionNav />
      <AiConversations
        sessions={container.services.aiSessions.list()}
        projects={container.services.aiSessions.projects()}
      />
    </main>
  );
}
