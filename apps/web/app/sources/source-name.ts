/** 多入口使用业务名称区分，其余官网按公司与招聘类别命名，不暴露适配器标识。 */
const sourceNames: Readonly<Record<string, string>> = {
  'kuaishou.intern': '快手日常实习',
  'kuaishou.intern.campus': '快手校园实习',
  'netease.campus.internet': '网易互联网校招',
  'netease.campus.games': '网易游戏校招',
  'netease.campus.leihuo': '网易雷火校招',
  'didi.campus': '滴滴校园招聘',
  'didi.campus.elite': '滴滴未来精英',
};

/** 名称仅用于展示，保留原官网 URL 与物理来源 ID 的操作语义。 */
export function sourceName(
  source: { adapterKey: string; companyName: string },
  channel: 'intern' | 'campus' | 'social',
): string {
  const labels = { intern: '实习招聘', campus: '校园招聘', social: '社会招聘' };
  return sourceNames[source.adapterKey] ?? `${source.companyName}${labels[channel]}`;
}
