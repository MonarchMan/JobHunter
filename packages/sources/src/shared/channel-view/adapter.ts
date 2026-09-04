import { SourceError, type DiscoveryEvent, type JobSourceAdapter } from '@jobhunter/source-core';

/** 来源适配器使用的类型约束。 */
export type CanonicalSourceChannel = 'intern' | 'campus' | 'social';

/** 来源适配器使用的数据结构或契约。 */
export interface ChannelViewDefinition<TConfig> {
  readonly key: string;
  readonly channel: CanonicalSourceChannel;
  readonly base: () => JobSourceAdapter<TConfig, never>;
}

/** 执行来源数据的解析、转换、请求或分页逻辑。 */
function category(channel: CanonicalSourceChannel): 'internship' | 'campus' | 'social' {
  return channel === 'intern' ? 'internship' : channel;
}

/** 创建按招聘类别筛选基础适配器结果的渠道视图。 */
export function createInlineChannelViewAdapter<TConfig>(
  // 1、校验基础适配器为 inline；2、包装发现事件并筛选类别；3、复用规范化和探活逻辑。
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
    /** 执行来源适配器的该项操作。 */
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
    /** 执行来源适配器的该项操作。 */
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
