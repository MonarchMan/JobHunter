import type { Metadata } from 'next';
import type { ReactElement, ReactNode } from 'react';
import { SiteNav } from './components/site-nav.js';
import './styles.css';

export const metadata: Metadata = {
  title: {
    default: '工作台 — JobHunter',
    template: '%s — JobHunter',
  },
  description: '个人求职 Agent 本地管理台',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>): ReactElement {
  return (
    <html lang="zh-CN">
      <body>
        <a className="skip-link" href="#main-content">
          跳到主要内容
        </a>
        <header className="site-header">
          <a className="brand" href="/">
            <span className="brand-mark" aria-hidden="true">
              J
            </span>
            <span>JobHunter</span>
          </a>
          <SiteNav />
        </header>
        {children}
      </body>
    </html>
  );
}
