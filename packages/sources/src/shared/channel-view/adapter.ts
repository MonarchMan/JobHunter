import { SourceError, type DiscoveryEvent, type JobSourceAdapter } from '@jobhunter/source-core';

export type CanonicalSourceChannel = 'intern' | 'campus' | 'social';

export interface ChannelViewDefinition<TConfig> {
  readonly key: string;
  readonly channel: CanonicalSourceChannel;
  readonly base: () => JobSourceAdapter<TConfig, never>;
}

function category(channel: CanonicalSourceChannel): 'internship' | 'campus' | 'social' {
  return channel === 'intern' ? 'internship' : channel;
}

export function createInlineChannelViewAdapter<TConfig>(
  definition: ChannelViewDefinition<TConfig>,
): JobSourceAdapter<TConfig, never> {
  const base = definition.base();
  if (base.metadata.capabilities.detail !== 'inline') {
    throw new SourceError('invalid_config', 'Channel views require inline source details.');
  }
  const expectedCategory = category(definition.channel);
  return {
    metadata: {
      ...base.metadata,
      key: definition.key,
      recruitmentType: definition.channel === 'social' ? 'social' : 'campus',
    },
    configSchema: base.configSchema,
    async *discover(context): AsyncIterable<DiscoveryEvent> {
      let discoveredCount = 0;
      for await (const event of base.discover(context)) {
        if (event.type === 'job') {
          const normalized = await base.normalize(
            { discovered: event.job, detail: null },
            { sourceId: context.sourceId, companyId: context.companyId, config: context.config },
          );
          if (normalized.job.recruitmentCategory !== expectedCategory) continue;
          discoveredCount += 1;
          yield event;
          continue;
        }
        if (event.type === 'page') {
          yield { ...event, discoveredCount };
          continue;
        }
        yield {
          ...event,
          discoveredCount,
          ...(event.diagnostics
            ? {
                diagnostics: {
                  ...event.diagnostics,
                  expectedCount: null,
                  discoveredCount,
                },
              }
            : {}),
        };
      }
    },
    async normalize(input, context) {
      const normalized = await base.normalize(input, context);
      if (normalized.job.recruitmentCategory !== expectedCategory) {
        throw new SourceError('parse_changed', 'Job does not belong to the configured channel.');
      }
      return normalized;
    },
    healthCheck: (context) => base.healthCheck(context),
  };
}
