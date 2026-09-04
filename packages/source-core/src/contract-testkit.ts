import { parseNormalizedJob } from '@jobhunter/domain';
import type {
  DiscoverContext,
  DiscoveryCoverage,
  DiscoveryEvent,
  JobSourceAdapter,
  RawJobInput,
} from './contract.js';
import { sourceMetadataSchema } from './contract.js';
import { canonicalizeOfficialUrl } from './url-policy.js';

/** 来源适配器使用的数据结构或契约。 */
export interface SourceContractFixture<TConfig, TDetail> {
  readonly context: DiscoverContext<TConfig>;
  readonly expectedExternalJobIds: readonly string[];
  readonly expectedCoverage: DiscoveryCoverage;
  readonly normalizationCases: readonly RawJobInput<TDetail>[];
  readonly fixtureText: string;
}

/** 来源适配器使用的数据结构或契约。 */
export interface SourceContractCase {
  readonly name: string;
  run(): Promise<void>;
}

/** 断言契约不变量并提供可读失败信息。 */
function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** 收集发现事件并校验恰好有一个完成事件。 */
export async function collectDiscovery(events: AsyncIterable<DiscoveryEvent>): Promise<{
  readonly ids: readonly string[];
  readonly completion: Extract<DiscoveryEvent, { type: 'complete' }>;
}> {
  const ids: string[] = [];
  const completions: Extract<DiscoveryEvent, { type: 'complete' }>[] = [];
  for await (const event of events) {
    if (event.type === 'job') ids.push(event.job.externalJobId);
    if (event.type === 'complete') completions.push(event);
  }
  invariant(completions.length === 1, 'Discovery must emit exactly one completion event.');
  const completion = completions[0];
  if (!completion) throw new Error('Discovery completion event disappeared.');
  return { ids, completion };
}

/** 拒绝契约固定样本中出现凭据或令牌形态。 */
export function assertFixtureContainsNoSensitiveContent(text: string): void {
  const patterns = [
    /authorization\s*:/i,
    /cookie\s*:/i,
    /bearer\s+[a-z0-9._-]+/i,
    /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/,
    /(?:api[-_]?key|password)\s*[:=]\s*[^\s"']+/i,
  ];
  for (const pattern of patterns) {
    invariant(
      !pattern.test(text),
      `Fixture contains sensitive material matching ${String(pattern)}.`,
    );
  }
}

/** 为来源适配器生成统一元数据、发现、规范化和脱敏测试。 */
export function defineSourceContractSuite<TConfig, TDetail>(
  factory: () => JobSourceAdapter<TConfig, TDetail>,
  fixture: SourceContractFixture<TConfig, TDetail>,
): readonly SourceContractCase[] {
  return [
    {
      name: 'declares valid metadata and capabilities',
      run(): Promise<void> {
        const adapter = factory();
        const metadata = sourceMetadataSchema.parse(adapter.metadata);
        canonicalizeOfficialUrl(metadata.canonicalEntryUrl, metadata.officialHosts);
        invariant(
          metadata.capabilities.detail !== 'deferred' || Boolean(adapter.fetchDetail),
          'Deferred-detail adapter must implement fetchDetail.',
        );
        return Promise.resolve();
      },
    },
    {
      name: 'discovers stable ordered IDs and reports coverage',
      async run(): Promise<void> {
        const first = await collectDiscovery(factory().discover(fixture.context));
        const second = await collectDiscovery(factory().discover(fixture.context));
        invariant(
          JSON.stringify(first.ids) === JSON.stringify(fixture.expectedExternalJobIds),
          'Discovery IDs differ from the fixture expectation.',
        );
        invariant(
          JSON.stringify(first.ids) === JSON.stringify(second.ids),
          'Discovery is unstable.',
        );
        invariant(
          first.completion.coverage === fixture.expectedCoverage,
          'Discovery coverage differs from the fixture expectation.',
        );
      },
    },
    {
      name: 'normalizes deterministically with official canonical URLs',
      async run(): Promise<void> {
        const adapter = factory();
        for (const normalizationCase of fixture.normalizationCases) {
          const context = {
            sourceId: fixture.context.sourceId,
            companyId: fixture.context.companyId,
            config: fixture.context.config,
          };
          const first = await adapter.normalize(normalizationCase, context);
          const second = await adapter.normalize(normalizationCase, context);
          invariant(JSON.stringify(first) === JSON.stringify(second), 'Normalization is unstable.');
          const job = parseNormalizedJob(first.job);
          canonicalizeOfficialUrl(job.detailUrl, adapter.metadata.officialHosts);
          canonicalizeOfficialUrl(job.applyUrl, adapter.metadata.officialHosts);
        }
      },
    },
    {
      name: 'contains no credential-shaped fixture content',
      run(): Promise<void> {
        assertFixtureContainsNoSensitiveContent(fixture.fixtureText);
        return Promise.resolve();
      },
    },
  ];
}
