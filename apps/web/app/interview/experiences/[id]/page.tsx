import { ExperienceDocumentNotFoundError } from '@jobhunter/application/web';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation.js';
import type { ReactElement } from 'react';
import { getWebContainer } from '../../../../src/server/container.js';
import { PageHeader } from '../../../components/page-header.js';
import { ExperienceReview } from './experience-review.js';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '面经校对' };

export default async function ExperienceDetailPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>): Promise<ReactElement> {
  const { id } = await params;
  try {
    const detail = (await getWebContainer()).services.experiences.get(id);
    const first = detail.experiences[0];
    return (
      <main id="main-content" tabIndex={-1}>
        <PageHeader
          eyebrow={detail.document.status === 'accepted' ? 'PERSONAL HISTORY' : 'REVIEW DRAFT'}
          title={`${first?.company ?? '公司待补充'} · ${first?.role ?? '岗位待补充'}`}
        >
          <div>
            <a className="button-secondary" href="/interview/experiences">
              返回历史面经
            </a>
          </div>
        </PageHeader>
        <ExperienceReview detail={detail} />
      </main>
    );
  } catch (error) {
    if (error instanceof ExperienceDocumentNotFoundError || error instanceof TypeError) notFound();
    throw error;
  }
}
