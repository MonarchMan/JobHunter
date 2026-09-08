import type { ResumeDescriptionBlock } from '@jobhunter/resume-template';

/** 使用浏览器编辑事务保留撤销栈；Range 手工改 DOM 无法提供等价撤销行为。 */
export function runEditingCommand(
  doc: Document,
  command: 'insertText' | 'insertUnorderedList',
  value?: string,
): void {
  // 1、仅开放固定命令，不允许用户输入成为命令名或 HTML。
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- 原生 contenteditable 暂无可替代且保留撤销栈的编辑事务 API。
  doc.execCommand(command, false, value);
}

/** 将浏览器编辑 DOM 投影为纯文本段落；不保留粘贴的标签、样式和事件。 */
export function readDescription(root: HTMLElement): ResumeDescriptionBlock[] {
  const blocks: ResumeDescriptionBlock[] = [];
  // 1、按块级边界遍历，列表项始终作为一条职责，避免换行丢失。
  const visit = (node: Node): void => {
    if (node.nodeType === 3) {
      if (node.textContent?.trim()) blocks.push({ type: 'paragraph', text: node.textContent });
      return;
    }
    if (node.nodeType !== 1) return;
    const element = node as HTMLElement;
    if (['SCRIPT', 'STYLE', 'IFRAME', 'BUTTON'].includes(element.tagName)) return;
    if (element.tagName === 'LI') {
      blocks.push({ type: 'bullet', text: element.innerText.replace(/\n$/u, '') });
    } else if (
      element.tagName === 'UL' ||
      element.tagName === 'OL' ||
      element.querySelector('p,div,ul,ol')
    ) {
      for (const child of element.childNodes) visit(child);
    } else {
      blocks.push({ type: 'paragraph', text: element.innerText.replace(/\n$/u, '') });
    }
  };
  for (const child of root.childNodes) visit(child);
  // 2、保留空段落供继续编辑；导出时由渲染器过滤。
  return blocks;
}

/** 列表行首退格取消圆点；其它键交给浏览器保留原生选区和撤销语义。 */
export function handleDescriptionKey(event: KeyboardEvent, root: HTMLElement): void {
  // 1、快捷键在编辑器内直接操作当前选区，不通过外部按钮移动焦点。
  if (
    !event.isComposing &&
    (event.ctrlKey || event.metaKey) &&
    event.shiftKey &&
    event.code === 'Digit8'
  ) {
    event.preventDefault();
    runEditingCommand(root.ownerDocument, 'insertUnorderedList');
    return;
  }
  // 2、中文输入法、其它组合快捷键和非退格操作不干预。
  if (
    event.isComposing ||
    event.key !== 'Backspace' ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey
  )
    return;
  const doc = root.ownerDocument;
  const selection = doc.getSelection();
  if (!selection?.isCollapsed || !selection.anchorNode || selection.rangeCount === 0) return;
  const node = selection.anchorNode;
  const item = (node.nodeType === 1 ? (node as Element) : node.parentElement)?.closest('li');
  if (!item || !root.contains(item)) return;
  // 3、仅在列表项起始处取消列表，普通文字中的退格保留删除文字行为。
  const before = doc.createRange();
  before.selectNodeContents(item);
  before.setEnd(node, selection.anchorOffset);
  if (before.toString().length !== 0) return;
  event.preventDefault();
  // 4、减少缩进不保证退出顶层列表；切换当前项的列表类型才会生成普通段落。
  // 浏览器编辑事务保留其它列表项、光标和撤销栈。
  runEditingCommand(doc, 'insertUnorderedList');
}

/** 粘贴仅接收纯文本，避免外部 HTML 改写模板或注入可执行内容。 */
export function pastePlainText(event: ClipboardEvent, root: HTMLElement): void {
  event.preventDefault();
  // 1、通过浏览器编辑事务插入纯文本，换行交给当前段落／列表上下文处理。
  runEditingCommand(
    root.ownerDocument,
    'insertText',
    event.clipboardData?.getData('text/plain') ?? '',
  );
}
