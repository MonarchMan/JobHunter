/** 重导出职位分类的规范化能力，供来源适配器统一使用。 */
export {
  canonicalJobFamilies,
  canonicalJobSubfamilies,
  canonicalizeJobTaxonomy,
  normalizeJobTaxonomy,
  type CanonicalJobFamily,
  type CanonicalJobSubfamily,
  type JobTaxonomy,
} from '@jobhunter/domain';
