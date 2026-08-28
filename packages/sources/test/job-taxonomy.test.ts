import { describe, expect, it } from 'vitest';
import { normalizeJobTaxonomy } from '../src/shared/normalization/job-taxonomy.js';

describe('job taxonomy', () => {
  it.each([
    ['后端开发', '研发', '后端'],
    ['算法工程师', '研发', '算法'],
    ['前端开发', '研发', '前端'],
    ['用户运营', '运营', null],
    ['未分类岗位', '其他', null],
  ])('%s maps to the canonical family and subfamily', (input, family, subfamily) => {
    expect(normalizeJobTaxonomy(input)).toEqual({ jobFamily: family, jobSubfamily: subfamily });
  });
});
