import { webJobQuerySchema, type WebJobQuery } from '@jobhunter/application/web';

export type SearchParameterSource = Readonly<
  Record<string, string | readonly string[] | undefined>
>;

export function firstSearchParameter(
  source: SearchParameterSource,
  name: string,
): string | undefined {
  const value = source[name];
  if (typeof value === 'string' || value === undefined) return value;
  return value[0];
}

function commaValues(value: string | undefined): string[] | undefined {
  const values = value
    ?.split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return values && values.length > 0 ? values : undefined;
}

export function parseWebJobQuery(source: SearchParameterSource): WebJobQuery {
  const minimumScoreText = firstSearchParameter(source, 'minScore');
  const limitText = firstSearchParameter(source, 'limit');
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
    ...(commaValues(firstSearchParameter(source, 'family'))
      ? { jobFamilies: commaValues(firstSearchParameter(source, 'family')) }
      : {}),
    ...(minimumScoreText ? { minimumScore: Number(minimumScoreText) } : {}),
    ...(firstSearchParameter(source, 'profile')
      ? { profileVersionId: firstSearchParameter(source, 'profile') }
      : {}),
    ...(firstSearchParameter(source, 'sort') ? { sort: firstSearchParameter(source, 'sort') } : {}),
    ...(firstSearchParameter(source, 'cursor')
      ? { cursor: firstSearchParameter(source, 'cursor') }
      : {}),
    ...(limitText ? { limit: Number(limitText) } : {}),
  });
}

export function queryRecord(searchParameters: URLSearchParams): SearchParameterSource {
  return Object.fromEntries(searchParameters.entries());
}

export function nextPageHref(source: SearchParameterSource, cursor: string): string {
  const parameters = new URLSearchParams();
  for (const [key, raw] of Object.entries(source)) {
    const value = typeof raw === 'string' || raw === undefined ? raw : raw[0];
    if (value && key !== 'cursor') parameters.set(key, value);
  }
  parameters.set('cursor', cursor);
  return `/jobs?${parameters.toString()}`;
}

export function firstPageHref(source: SearchParameterSource): string {
  const parameters = new URLSearchParams();
  for (const [key, raw] of Object.entries(source)) {
    const value = typeof raw === 'string' || raw === undefined ? raw : raw[0];
    if (value && key !== 'cursor') parameters.set(key, value);
  }
  const query = parameters.toString();
  return query ? `/jobs?${query}` : '/jobs';
}
