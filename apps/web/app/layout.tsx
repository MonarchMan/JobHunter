import type { Metadata } from 'next';
import type { ReactElement, ReactNode } from 'react';
import { SiteNav } from './components/site-nav.js';
import './styles.css';
import styles from './app-shell.module.css';
import { ToastProvider } from './components/toast-provider.js';

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
      <body className={styles.body}>
        <ToastProvider>
          <a className="skip-link" href="#main-content">
            跳到主要内容
          </a>
          <header className={styles.header}>
            <a className={styles.brand} href="/">
              <img
                className={styles.brandMark}
                src="/assets/brand/jobhunter-logo.png"
                alt=""
                width={30}
                height={30}
                data-brand-logo="navigation"
              />
              <span>JobHunter</span>
            </a>
            <SiteNav />
          </header>
          {children}
        </ToastProvider>
      </body>
    </html>
  );
}
