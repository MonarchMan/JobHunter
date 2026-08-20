import { createHash } from 'node:crypto';
import { canonicalJson } from '@jobhunter/domain';

export interface ExternalIdFingerprintInput {
  readonly sourceKey: string;
  readonly algorithmVersion: string;
  readonly parts: Readonly<Record<string, string | readonly string[] | null>>;
}

export function createExternalIdFingerprint(input: ExternalIdFingerprintInput): string {
  if (!input.sourceKey.trim() || !input.algorithmVersion.trim()) {
    throw new TypeError('Fingerprint source key and algorithm version are required.');
  }
  const hash = createHash('sha256')
    .update(
      canonicalJson({
        sourceKey: input.sourceKey.trim(),
        algorithmVersion: input.algorithmVersion.trim(),
        parts: input.parts,
      }),
    )
    .digest('hex');
  return `fp:${input.algorithmVersion}:${hash}`;
}
