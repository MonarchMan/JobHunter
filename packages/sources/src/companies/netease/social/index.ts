import type { JobSourceAdapter } from '@jobhunter/source-core';
import { createInlineChannelViewAdapter } from '../../../shared/channel-view/index.js';
import { createNeteaseAdapter } from '../mixed/index.js';
import type { NeteaseConfig } from '../mixed/schemas.js';

/** 创建网易社会招聘渠道视图适配器。 */
export const createNeteaseSocialAdapter = (): JobSourceAdapter<NeteaseConfig, never> =>
  createInlineChannelViewAdapter({
    key: 'netease.social',
    channel: 'social',
    base: createNeteaseAdapter,
  });
