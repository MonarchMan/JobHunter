import { createHash } from 'node:crypto';
import { canonicalJson } from '@jobhunter/domain';

/** 来源适配器使用的数据结构或契约。 */
export interface ExternalIdFingerprintInput {
  readonly sourceKey: string;
  readonly algorithmVersion: string;
  readonly parts: Readonly<Record<string, string | readonly string[] | null>>;
}

/** 使用规范 JSON 和 SHA-256 生成来源隔离的外部 ID 指纹。 */
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
