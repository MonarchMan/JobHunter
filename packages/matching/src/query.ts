export interface MatchListItem {
  readonly jobId: string;
  readonly jobStatus: 'active' | 'stale' | 'closed';
  readonly filterStatus: 'eligible' | 'excluded' | 'uncertain';
  readonly totalScore: number;
  readonly publishedAt: number | null;
  readonly lastSeenAt: number;
}

export interface MatchListFilter {
  readonly includeExcluded?: boolean;
  readonly includeStale?: boolean;
  readonly includeClosed?: boolean;
}

export function filterCurrentRecommendations(
  items: readonly MatchListItem[],
  filter: MatchListFilter = {},
): readonly MatchListItem[] {
  return items.filter((item) => {
    if (!filter.includeExcluded && item.filterStatus === 'excluded') return false;
    if (item.jobStatus === 'active') return true;
    if (item.jobStatus === 'stale') return filter.includeStale === true;
    return filter.includeClosed === true;
  });
}

export function sortMatches(items: readonly MatchListItem[]): readonly MatchListItem[] {
  return items.toSorted((left, right) => {
    const score = right.totalScore - left.totalScore;
    if (score !== 0) return score;
    const leftRecency = left.publishedAt ?? left.lastSeenAt;
    const rightRecency = right.publishedAt ?? right.lastSeenAt;
    const recency = rightRecency - leftRecency;
    return recency !== 0 ? recency : left.jobId.localeCompare(right.jobId);
  });
}
