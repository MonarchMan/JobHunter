import type { JobSourceAdapter } from '@jobhunter/source-core';
import { createInlineChannelViewAdapter } from '../../../shared/channel-view/index.js';
import { createNeteaseAdapter } from '../mixed/index.js';
import type { NeteaseConfig } from '../mixed/schemas.js';

export const createNeteaseInternAdapter = (): JobSourceAdapter<NeteaseConfig, never> =>
  createInlineChannelViewAdapter({
    key: 'netease.intern',
    channel: 'intern',
    base: createNeteaseAdapter,
  });
