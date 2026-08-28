import type { AdapterRegistry } from '@jobhunter/source-core';
import { createInlineChannelViewAdapter } from '../shared/channel-view/index.js';
import {
  createAlibabaAdapter,
  createAlibabaSocialAdapter,
} from '../companies/alibaba/campus/index.js';
import { createBaiduAdapter, createBaiduSocialAdapter } from '../companies/baidu/campus/index.js';
import { createByteDanceCampusAdapter } from '../companies/bytedance/intern/index.js';
import { createByteDanceAdapter } from '../companies/bytedance/social/index.js';
import { createDewuAdapter, createDewuSocialAdapter } from '../companies/dewu/campus/index.js';
import {
  createHuaweiAdapter,
  createHuaweiCampusAdapter,
} from '../companies/huawei/campus/index.js';
import { createHuaweiSocialAdapter } from '../companies/huawei/social/index.js';
import { createJdCampusAdapter, createJdInternAdapter } from '../companies/jd/campus/index.js';
import { createJdAdapter } from '../companies/jd/social/index.js';
import {
  createMeituanCampusAdapter,
  createMeituanInternAdapter,
} from '../companies/meituan/intern/index.js';
import { createMeituanAdapter } from '../companies/meituan/social/index.js';
import { createNeteaseInternAdapter } from '../companies/netease/intern/index.js';
import { createNeteaseSocialAdapter } from '../companies/netease/social/index.js';
import {
  createNeteaseCampusGamesAdapter,
  createNeteaseCampusInternetAdapter,
  createNeteaseCampusLeihuoAdapter,
} from '../companies/netease/campus/index.js';
import {
  createOppoCampusAdapter,
  createOppoInternAdapter,
} from '../companies/oppo/intern/index.js';
import { createOppoSocialAdapter } from '../companies/oppo/social/index.js';
import {
  createPinduoduoAdapter,
  createPinduoduoCampusAdapter,
} from '../companies/pinduoduo/intern/index.js';
import { createQihoo360SocialAdapter } from '../companies/qihoo360/social/index.js';
import {
  createQihoo360CampusAdapter,
  createQihoo360InternAdapter,
} from '../companies/qihoo360/campus/index.js';
import {
  createTencentCampusAdapter,
  createTencentInternAdapter,
} from '../companies/tencent/intern/index.js';
import { createTencentAdapter } from '../companies/tencent/social/index.js';
import { createVivoSocialAdapter } from '../companies/vivo/social/index.js';
import {
  createVivoCampusAdapter,
  createVivoInternAdapter,
} from '../companies/vivo/campus/index.js';
import {
  createXiaomiCampusAdapter,
  createXiaomiInternAdapter,
  createXiaomiSocialAdapter,
} from '../companies/xiaomi/intern/index.js';
import {
  createXiaohongshuAdapter,
  createXiaohongshuSocialAdapter,
} from '../companies/xiaohongshu/campus/index.js';

export function registerFirstPartyAdapters(registry: AdapterRegistry): void {
  registry.register(
    createInlineChannelViewAdapter({
      key: 'alibaba.campus',
      channel: 'campus',
      base: createAlibabaAdapter,
    }),
  );
  registry.register(createAlibabaSocialAdapter());
  registry.register(createDewuSocialAdapter());
  registry.register(createBaiduSocialAdapter());
  registry.register(
    createInlineChannelViewAdapter({
      key: 'alibaba.intern',
      channel: 'intern',
      base: createAlibabaAdapter,
    }),
  );
  registry.register(
    createInlineChannelViewAdapter({
      key: 'baidu.campus',
      channel: 'campus',
      base: createBaiduAdapter,
    }),
  );
  registry.register(
    createInlineChannelViewAdapter({
      key: 'baidu.intern',
      channel: 'intern',
      base: createBaiduAdapter,
    }),
  );
  registry.register(createByteDanceAdapter());
  registry.register(
    createInlineChannelViewAdapter({
      key: 'bytedance.campus',
      channel: 'campus',
      base: createByteDanceCampusAdapter,
    }),
  );
  registry.register(
    createInlineChannelViewAdapter({
      key: 'bytedance.intern',
      channel: 'intern',
      base: createByteDanceCampusAdapter,
    }),
  );
  registry.register(
    createInlineChannelViewAdapter({
      key: 'dewu.campus',
      channel: 'campus',
      base: createDewuAdapter,
    }),
  );
  registry.register(
    createInlineChannelViewAdapter({
      key: 'dewu.intern',
      channel: 'intern',
      base: createDewuAdapter,
    }),
  );
  registry.register(createHuaweiAdapter());
  registry.register(createHuaweiCampusAdapter());
  registry.register(createHuaweiSocialAdapter());
  registry.register(createJdInternAdapter());
  registry.register(createJdCampusAdapter());
  registry.register(createJdAdapter());
  registry.register(createMeituanAdapter());
  registry.register(createMeituanInternAdapter());
  registry.register(createMeituanCampusAdapter());
  registry.register(createNeteaseInternAdapter());
  registry.register(createNeteaseSocialAdapter());
  registry.register(createNeteaseCampusInternetAdapter());
  registry.register(createNeteaseCampusGamesAdapter());
  registry.register(createNeteaseCampusLeihuoAdapter());
  registry.register(createOppoInternAdapter());
  registry.register(createOppoCampusAdapter());
  registry.register(createOppoSocialAdapter());
  registry.register(createPinduoduoAdapter());
  registry.register(createPinduoduoCampusAdapter());
  registry.register(createQihoo360SocialAdapter());
  registry.register(createQihoo360InternAdapter());
  registry.register(createQihoo360CampusAdapter());
  registry.register(createTencentAdapter());
  registry.register(createTencentInternAdapter());
  registry.register(createTencentCampusAdapter());
  registry.register(createVivoSocialAdapter());
  registry.register(createVivoInternAdapter());
  registry.register(createVivoCampusAdapter());
  registry.register(createXiaomiInternAdapter());
  registry.register(createXiaomiCampusAdapter());
  registry.register(createXiaomiSocialAdapter());
  registry.register(createXiaohongshuSocialAdapter());
  registry.register(
    createInlineChannelViewAdapter({
      key: 'xiaohongshu.campus',
      channel: 'campus',
      base: createXiaohongshuAdapter,
    }),
  );
  registry.register(
    createInlineChannelViewAdapter({
      key: 'xiaohongshu.intern',
      channel: 'intern',
      base: createXiaohongshuAdapter,
    }),
  );
}
