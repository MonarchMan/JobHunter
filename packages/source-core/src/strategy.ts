import type { SourceMetadata } from './contract.js';
import { SourceError } from './errors.js';

const strategyRank = {
  json: 0,
  embedded_json: 1,
  html: 2,
  browser: 3,
} as const;

export function compareCollectionStrategies(
  left: SourceMetadata['capabilities']['transport'],
  right: SourceMetadata['capabilities']['transport'],
): number {
  return strategyRank[left] - strategyRank[right];
}

export function assertPublicCollectionStrategy(input: {
  readonly requiresLogin: boolean;
  readonly usesSessionCookie: boolean;
  readonly bypassesChallenge: boolean;
}): void {
  if (input.requiresLogin || input.usesSessionCookie || input.bypassesChallenge) {
    throw new SourceError(
      'access_blocked',
      'Source strategy requires prohibited authentication or challenge bypass.',
    );
  }
}
