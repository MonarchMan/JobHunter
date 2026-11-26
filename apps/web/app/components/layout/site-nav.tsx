'use client';

import { usePathname } from 'next/navigation.js';
import type { ReactElement } from 'react';
import { useRef } from 'react';
import { Icon } from '../ui-icon.js';
import { NavigationLink } from './navigation-pending.js';
import styles from './site-nav.module.css';

const primaryLinks = [
  { href: '/', label: '工作台', icon: 'dashboard' },
  { href: '/jobs', label: '职位', icon: 'jobs' },
  { href: '/interview', label: '面试准备', shortLabel: '面试', icon: 'interview' },
  { href: '/my', label: '我的', shortLabel: '我的', icon: 'profile' },
] as const;

const secondaryLinks = [
  { href: '/sources', label: '来源', icon: 'sources' },
  { href: '/tasks', label: '任务', icon: 'tasks' },
  { href: '/settings', label: '设置', icon: 'settings' },
] as const;

function isCurrentPath(pathname: string, href: string): boolean {
  if (href === '/my') {
    return (
      pathname === '/my' ||
      pathname === '/profile' ||
      pathname.startsWith('/profile/') ||
      pathname === '/applications' ||
      pathname.startsWith('/applications/')
    );
  }
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

/** 仅对已有加载边界的动态入口预取轻量外壳。 */
function shellPrefetch(href: string): false | null {
  return href === '/jobs' || href === '/my' || href === '/tasks' || href === '/settings'
    ? null
    : false;
}

export function SiteNav(): ReactElement {
  const pathname = usePathname();
  const moreNavigationReference = useRef<HTMLDetailsElement>(null);
  const secondaryActive = secondaryLinks.some((link) => isCurrentPath(pathname, link.href));

  return (
    <nav className={styles.nav} aria-label="主导航">
      {primaryLinks.map((link) => {
        const current = isCurrentPath(pathname, link.href);
        return (
          <NavigationLink
            className={[styles.link, current ? styles.current : undefined]
              .filter(Boolean)
              .join(' ')}
            href={link.href}
            prefetch={shellPrefetch(link.href)}
            aria-current={current ? 'page' : undefined}
            key={link.href}
          >
            <Icon name={link.icon} />
            <span className={styles.fullLabel}>{link.label}</span>
            <span className={styles.shortLabel}>
              {'shortLabel' in link ? link.shortLabel : link.label}
            </span>
          </NavigationLink>
        );
      })}
      {secondaryLinks.map((link) => {
        const current = isCurrentPath(pathname, link.href);
        return (
          <NavigationLink
            className={[styles.link, styles.secondary, current ? styles.current : undefined]
              .filter(Boolean)
              .join(' ')}
            href={link.href}
            prefetch={shellPrefetch(link.href)}
            aria-current={current ? 'page' : undefined}
            key={link.href}
          >
            <Icon name={link.icon} />
            {link.label}
          </NavigationLink>
        );
      })}
      <details
        ref={moreNavigationReference}
        className={styles.more}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            moreNavigationReference.current?.removeAttribute('open');
            moreNavigationReference.current?.querySelector('summary')?.focus();
          }
        }}
      >
        <summary
          className={[styles.link, secondaryActive ? styles.current : undefined]
            .filter(Boolean)
            .join(' ')}
        >
          <Icon name="more" />
          更多
        </summary>
        <div className={styles.moreMenu}>
          {secondaryLinks.map((link) => {
            const current = isCurrentPath(pathname, link.href);
            return (
              <NavigationLink
                className={[styles.moreLink, current ? styles.moreLinkCurrent : undefined]
                  .filter(Boolean)
                  .join(' ')}
                href={link.href}
                prefetch={shellPrefetch(link.href)}
                aria-current={current ? 'page' : undefined}
                key={link.href}
                onClick={() => moreNavigationReference.current?.removeAttribute('open')}
              >
                <Icon name={link.icon} />
                {link.label}
              </NavigationLink>
            );
          })}
        </div>
      </details>
    </nav>
  );
}
