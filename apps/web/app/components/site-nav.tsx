'use client';

import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';

const links = [
  { href: '/', label: '工作台' },
  { href: '/jobs', label: '职位' },
  { href: '/profile', label: '我的画像' },
  { href: '/sources', label: '来源' },
  { href: '/tasks', label: '任务' },
] as const;

function isCurrentPath(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

export function SiteNav(): ReactElement {
  const [pathname, setPathname] = useState('');

  useEffect(() => {
    setPathname(window.location.pathname);
  }, []);

  return (
    <nav className="site-nav" aria-label="主导航">
      {links.map((link) => {
        const current = isCurrentPath(pathname, link.href);
        return (
          <a
            className={current ? 'site-nav-link is-active' : 'site-nav-link'}
            href={link.href}
            aria-current={current ? 'page' : undefined}
            key={link.href}
          >
            {link.label}
          </a>
        );
      })}
    </nav>
  );
}
