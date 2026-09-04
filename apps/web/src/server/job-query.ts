import { webJobQuerySchema, type WebJobQuery } from '@jobhunter/application/web';

/** 模块使用的类型约束。 */
export type SearchParameterSource = Readonly<
  Record<string, string | readonly string[] | undefined>
>;

/** 读取同名查询参数的第一个非空值。 */
export function firstSearchParameter(
  source: SearchParameterSource,
  name: string,
): string | undefined {
  const value = source[name];
  if (typeof value === 'string' || value === undefined) return value;
  return value[0];
}

/** 解析 Web 查询中的逗号分隔数组。 */
function commaValues(value: string | undefined): string[] | undefined {
  const values = value
    ?.split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return values && values.length > 0 ? values : undefined;
}

/** 将 URL 查询参数校验并转换为职位查询对象。 */
export function parseWebJobQuery(source: SearchParameterSource): WebJobQuery {
  const minimumScoreText = firstSearchParameter(source, 'minScore');
  const limitText = firstSearchParameter(source, 'limit');
  const pageText = firstSearchParameter(source, 'page');
  return webJobQuerySchema.parse({
    ...(firstSearchParameter(source, 'q') ? { search: firstSearchParameter(source, 'q') } : {}),
    ...(commaValues(firstSearchParameter(source, 'company'))
      ? { companies: commaValues(firstSearchParameter(source, 'company')) }
      : {}),
    ...(commaValues(firstSearchParameter(source, 'status'))
      ? { statuses: commaValues(firstSearchParameter(source, 'status')) }
      : {}),
    ...(commaValues(firstSearchParameter(source, 'location'))
      ? { locations: commaValues(firstSearchParameter(source, 'location')) }
      : {}),
    ...(commaValues(firstSearchParameter(source, 'subfamily'))
      ? { jobSubfamilies: commaValues(firstSearchParameter(source, 'subfamily')) }
      : {}),
    ...(firstSearchParameter(source, 'category')
      ? { recruitmentCategory: firstSearchParameter(source, 'category') }
      : {}),
    ...(minimumScoreText ? { minimumScore: Number(minimumScoreText) } : {}),
    ...(firstSearchParameter(source, 'profile')
      ? { profileVersionId: firstSearchParameter(source, 'profile') }
      : {}),
    ...(firstSearchParameter(source, 'sort') ? { sort: firstSearchParameter(source, 'sort') } : {}),
    ...(pageText ? { page: Number(pageText) } : {}),
    ...(firstSearchParameter(source, 'cursor')
      ? { cursor: firstSearchParameter(source, 'cursor') }
      : {}),
    ...(limitText ? { limit: Number(limitText) } : {}),
  });
}

/** 将 URLSearchParams 转换为可复用的查询参数记录。 */
export function queryRecord(searchParameters: URLSearchParams): SearchParameterSource {
  return Object.fromEntries(searchParameters.entries());
}

/** 生成保留当前筛选条件的下一页链接。 */
export function nextPageHref(source: SearchParameterSource, cursor: string): string {
  const parameters = new URLSearchParams();
  for (const [key, raw] of Object.entries(source)) {
    const value = typeof raw === 'string' || raw === undefined ? raw : raw[0];
    if (value && key !== 'cursor') parameters.set(key, value);
  }
  parameters.set('cursor', cursor);
  return `/jobs?${parameters.toString()}`;
}

/** 生成回到第一页且保留当前筛选条件的链接。 */
export function firstPageHref(source: SearchParameterSource): string {
  const parameters = new URLSearchParams();
  for (const [key, raw] of Object.entries(source)) {
    const value = typeof raw === 'string' || raw === undefined ? raw : raw[0];
    if (value && key !== 'cursor') parameters.set(key, value);
  }
  const query = parameters.toString();
  return query ? `/jobs?${query}` : '/jobs';
}

/** 生成指定页码并保留当前筛选条件的链接。 */
export function pageHref(
  source: SearchParameterSource,
  pageParameter: string,
  page: number,
): string {
  const parameters = new URLSearchParams();
  for (const [key, raw] of Object.entries(source)) {
    const value = typeof raw === 'string' || raw === undefined ? raw : raw[0];
    if (value && key !== 'cursor' && key !== pageParameter) parameters.set(key, value);
  }
  if (page > 1) parameters.set(pageParameter, String(page));
  const query = parameters.toString();
  return query ? `?${query}` : '';
}
