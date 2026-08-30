import { ProjectDossierNotFoundError } from '@jobhunter/application/web';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation.js';
import type { ReactElement } from 'react';
import { getWebContainer } from '../../../../src/server/container.js';
import { PageHeader } from '../../../components/page-header.js';
import { DrillWorkbench, type DrillTaskView } from './workbench.js';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '项目拷打' };

interface ProjectDrillPageProperties {
  readonly params: Promise<{ readonly id: string }>;
}

export default async function ProjectDrillPage({
  params,
}: ProjectDrillPageProperties): Promise<ReactElement> {
  const { id } = await params;
  const container = await getWebContainer();
  try {
    const detail = container.services.interview.getDossier(id);
    const taskIds = [
      ...new Set(
        detail.turns.flatMap((turn) =>
          [turn.questionTaskId, turn.digestTaskId].filter(
            (value): value is NonNullable<typeof value> => Boolean(value),
          ),
        ),
      ),
    ];
    const tasks = Object.fromEntries(
      taskIds.flatMap((taskId) => {
        const task = container.services.tasks.get(taskId);
        return task
          ? [
              [
                taskId,
                {
                  status: task.status,
                  errorCategory: task.errorCategory,
                  errorSummary: task.errorSummary,
                } satisfies DrillTaskView,
              ],
            ]
          : [];
      }),
    );
    return (
      <main id="main-content" tabIndex={-1}>
        <PageHeader title={detail.snapshot.project.name}>
          <div>
            <a className="button-secondary" href="/interview">
              返回准备档案
            </a>
          </div>
        </PageHeader>
        <DrillWorkbench detail={detail} tasks={tasks} />
      </main>
    );
  } catch (error) {
    if (error instanceof ProjectDossierNotFoundError || error instanceof TypeError) notFound();
    throw error;
  }
}
