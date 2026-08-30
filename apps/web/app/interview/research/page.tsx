import { webCommunityExperienceFilterSchema } from '@jobhunter/application/web';
import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { getWebContainer } from '../../../src/server/container.js';
import { firstSearchParameter, type SearchParameterSource } from '../../../src/server/job-query.js';
import { PageHeader } from '../../components/page-header.js';
import { InterviewSectionNav } from '../interview-section-nav.js';
import { ResearchIndex } from './research-index.js';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '网友面经' };

function facetValues(values: readonly (string | null)[]): readonly string[] {
  return [...new Set(values.filter((value): value is string => value !== null))].sort(
    (left, right) => left.localeCompare(right, 'zh-CN'),
  );
}

export default async function ResearchPage({
  searchParams,
}: Readonly<{ searchParams: Promise<SearchParameterSource> }>): Promise<ReactElement> {
  const parameters = await searchParams;
  const filterResult = webCommunityExperienceFilterSchema.safeParse({
    ...(firstSearchParameter(parameters, 'company')
      ? { company: firstSearchParameter(parameters, 'company') }
      : {}),
    ...(firstSearchParameter(parameters, 'role')
      ? { role: firstSearchParameter(parameters, 'role') }
      : {}),
    ...(firstSearchParameter(parameters, 'stage')
      ? { stage: firstSearchParameter(parameters, 'stage') }
      : {}),
  });
  const acceptedFilter = filterResult.success ? filterResult.data : {};
  const service = (await getWebContainer()).services.research;
  const allAccepted = service.listAccepted();
  return (
    <main id="main-content" tabIndex={-1}>
      <PageHeader
        eyebrow="COMMUNITY INTERVIEW RESEARCH"
        title="网友面经"
        description="定义目标岗位，把公开网络调研交给本地 Codex，再逐条核对来源与内容。只有你接受的候选才会进入网友面经。"
      />
      <InterviewSectionNav />
      <ResearchIndex
        requests={service.listRequests()}
        accepted={service.listAccepted(acceptedFilter)}
        acceptedFilter={acceptedFilter}
        acceptedTotal={allAccepted.length}
        acceptedFacets={{
          companies: facetValues(allAccepted.map(({ experience }) => experience.company)),
          roles: facetValues(allAccepted.map(({ experience }) => experience.role)),
          stages: facetValues(allAccepted.map(({ experience }) => experience.stage)),
        }}
      />
    </main>
  );
}
