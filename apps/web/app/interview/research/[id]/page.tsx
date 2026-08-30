import { ExperienceResearchNotFoundError } from '@jobhunter/application/web';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation.js';
import type { ReactElement } from 'react';
import { getWebContainer } from '../../../../src/server/container.js';
import { PageHeader } from '../../../components/page-header.js';
import { InterviewSectionNav } from '../../interview-section-nav.js';
import { ResearchWorkbench, type ResearchTaskView } from './research-workbench.js';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '网友面经研究' };

export default async function ResearchDetailPage({
  params,
}: Readonly<{ params: Promise<{ readonly id: string }> }>): Promise<ReactElement> {
  const { id } = await params;
  const container = await getWebContainer();
  try {
    const detail = container.services.research.get(id);
    const task = detail.request.currentTaskId
      ? container.services.tasks.get(detail.request.currentTaskId)
      : null;
    const taskView: ResearchTaskView | null = task
      ? {
          id: task.id,
          status: task.status,
          errorCategory: task.errorCategory,
        }
      : null;
    return (
      <main id="main-content" tabIndex={-1}>
        <PageHeader
          title={detail.request.brief.targetRoles.join(' / ')}
          description="交接材料不包含你的简历或项目目录；外部 Agent 只需返回符合 Schema 的公开来源研究包。"
        >
          <a className="button-secondary" href="/interview/research">
            返回研究列表
          </a>
        </PageHeader>
        <InterviewSectionNav />
        <ResearchWorkbench detail={detail} task={taskView} />
      </main>
    );
  } catch (error) {
    if (error instanceof ExperienceResearchNotFoundError || error instanceof TypeError) notFound();
    throw error;
  }
}
