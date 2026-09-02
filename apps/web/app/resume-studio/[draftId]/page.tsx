import type { Metadata } from 'next';
import { notFound } from 'next/navigation.js';
import type { ReactElement } from 'react';
import { ResumeTemplateNotFoundError } from '@jobhunter/application/web';
import { getWebContainer } from '../../../src/server/container.js';
import { ResumeStudio } from './resume-studio.js';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '简历制作' };

interface PageProperties {
  readonly params: Promise<{ readonly draftId: string }>;
}

export default async function ResumeStudioPage({ params }: PageProperties): Promise<ReactElement> {
  const { draftId } = await params;
  const container = await getWebContainer();
  try {
    const detail = await container.services.resumeTemplates.detail(draftId);
    return <ResumeStudio initial={detail} />;
  } catch (error) {
    if (error instanceof ResumeTemplateNotFoundError) notFound();
    throw error;
  }
}
