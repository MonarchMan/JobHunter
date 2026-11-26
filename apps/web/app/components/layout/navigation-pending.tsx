'use client';

import NextLink from 'next/link.js';
import type { ComponentProps, ReactElement } from 'react';

// NodeNext 将 Next.js 的 CommonJS 入口推断为模块对象，实际默认导出是链接组件。
const Link = NextLink as unknown as typeof NextLink.default;

/** 站内页面链接保留原生链接语义，默认不为未访问的页面执行查询。 */
export function NavigationLink(props: ComponentProps<typeof Link>): ReactElement {
  return <Link prefetch={false} {...props} />;
}
