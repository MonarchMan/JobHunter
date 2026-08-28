export const recruitmentCategories = ['internship', 'campus', 'social'] as const;
export type RecruitmentCategory = (typeof recruitmentCategories)[number];

export function normalizeRecruitmentCategory(
  value: string | null | undefined,
): RecruitmentCategory | null {
  const text = value?.trim().toLocaleLowerCase();
  if (!text) return null;
  if (/(实习|intern|internship)/u.test(text)) return 'internship';
  if (/(校招|应届|campus|graduate)/u.test(text)) return 'campus';
  if (/(社招|社会招聘|全职|正式|social|full.?time)/u.test(text)) return 'social';
  return null;
}
