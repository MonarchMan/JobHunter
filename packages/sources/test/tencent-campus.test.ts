import { parseId } from '@jobhunter/domain';
import { SourceError, type SourceHttpClient } from '@jobhunter/source-core';
import { describe, expect, it } from 'vitest';
import {
  createTencentInternAdapter,
  tencentCampusConfigSchema,
  tencentCampusDetailResponseSchema,
} from '../src/index.js';

const companyId = parseId('018f0000-0000-7000-8000-000000000101', 'Company');
const sourceId = parseId('018f0000-0000-7000-8000-000000000211', 'JobSource');
const discovered = {
  externalJobId: '1231829074692139076',
  sourceUrl: 'https://join.qq.com/post_detail.html?postid=1231829074692139076',
  raw: {
    postId: '1231829074692139076',
    positionTitle: '元宝—多模态搜索研究',
    positionFamily: 7,
    projectId: 20,
    projectName: '青云计划-实习生',
    recruitLabelName: '实习生 青云计划',
    workCities: '北京',
  },
} as const;

function qingyunResponse(topicDetail: string, topicRequirement: string): unknown {
  return {
    status: 0,
    data: {
      postId: discovered.externalJobId,
      title: discovered.raw.positionTitle,
      tidName: '青云课题',
      desc: '',
      request: '',
      topicDetail,
      topicRequirement,
      workCityList: ['北京'],
      projectName: discovered.raw.projectName,
      recruitLabelName: discovered.raw.recruitLabelName,
      internBonus: '',
    },
  };
}

describe('Tencent internship detail variants', () => {
  it('normalizes Qingyun topic fields when ordinary detail fields are empty', async () => {
    const adapter = createTencentInternAdapter();
    const detail = tencentCampusDetailResponseSchema.parse(
      qingyunResponse('课题背景与具体工作', '候选人课题要求'),
    ).data;
    const normalized = await adapter.normalize(
      { discovered, detail },
      { sourceId, companyId, config: tencentCampusConfigSchema.parse({}) },
    );

    expect(normalized.job.description).toContain('课题背景与具体工作');
    expect(normalized.job.description).toContain('候选人课题要求');
    expect(normalized.provenance.description).toBe('$.data.topicDetail+$.data.topicRequirement');
  });

  it('reports concrete missing content fields as parse_changed', async () => {
    const adapter = createTencentInternAdapter();
    const http: SourceHttpClient = {
      request: () =>
        Promise.resolve({
          status: 200,
          url: discovered.sourceUrl,
          headers: new Headers(),
          body: qingyunResponse('', ''),
        }),
    };

    try {
      await adapter.fetchDetail?.(discovered, {
        sourceId,
        companyId,
        requestId: 'tencent-qingyun-detail',
        config: tencentCampusConfigSchema.parse({}),
        signal: new AbortController().signal,
        timeoutMs: 1_000,
        http,
      });
      throw new Error('Expected Tencent detail parsing to fail.');
    } catch (error) {
      expect(error).toBeInstanceOf(SourceError);
      if (!(error instanceof SourceError)) throw error;
      expect(error.category).toBe('parse_changed');
      expect(error.safeDiagnostic).toContain('data.desc');
    }
  });
});
