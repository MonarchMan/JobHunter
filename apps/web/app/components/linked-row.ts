import type { MouseEvent } from 'react';

/** 表格行与移动记录卡的指针增强；真正的链接仍负责键盘和路由语义。 */
export function openLinkedRow(event: MouseEvent<HTMLElement>): void {
  // 1、保留子控件、portal、文本选择及浏览器修饰键操作，不吞掉原有行为。
  const target = event.target;
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    !(target instanceof Element) ||
    !event.currentTarget.contains(target) ||
    target.closest(
      'a, button, input, label, select, textarea, summary, [role="button"], [role="link"], [contenteditable], [data-row-navigation-ignore]',
    ) ||
    event.currentTarget.ownerDocument.getSelection()?.isCollapsed === false
  )
    return;
  // 2、点击同一行的原生链接而非另造导航；其冒泡会被上面的 a 检查终止。
  event.currentTarget.querySelector<HTMLAnchorElement>('a[data-row-detail-link]')?.click();
}
