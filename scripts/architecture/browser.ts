import type { Diagram, DiagramNode } from './model.js';

/** 获取构建器保证存在的元素，缺失时显式报错以暴露模板漂移。 */
function element(id: string): HTMLElement {
  const result = document.getElementById(id);
  if (!result) throw new Error(`页面元素缺失：${id}`);
  return result;
}

/** 离线模板的必需引用在缺失时立即失败，避免后续产生难以定位的空引用。 */
function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('架构页面缺少必需数据');
  return value;
}

const data = JSON.parse(element('diagram-data').textContent) as Diagram;
const viewport = element('viewport');
const extent = element('extent');
const stage = element('stage');
const status = element('status');
const initialView = required(data.views[0]);
let current = initialView;
let selected = '';
let zoom = 1;
let drag: { x: number; y: number; left: number; top: number } | undefined;

/** 同一选择用于高亮、详情与关系按钮，不修改图的源数据。 */
function refresh(): void {
  // 1. 选中节点及其直接邻居保持可见，其余关系淡出。
  const related = new Set([selected]);
  for (const edge of current.edges) {
    if (edge.from === selected || edge.to === selected) {
      related.add(edge.from);
      related.add(edge.to);
    }
  }
  for (const button of stage.querySelectorAll<HTMLButtonElement>('.node')) {
    const id = required(button.dataset.id);
    button.classList.toggle('dimmed', Boolean(selected && !related.has(id)));
    button.setAttribute('aria-pressed', String(id === selected));
  }
  for (const edge of stage.querySelectorAll<SVGGElement>('.edge')) {
    const involved = edge.dataset.from === selected || edge.dataset.to === selected;
    edge.classList.toggle('highlight', Boolean(selected && involved));
    edge.classList.toggle('dimmed', Boolean(selected && !involved));
  }
  status.textContent = `${String(current.nodes.length)} 个节点 · ${String(current.edges.length)} 条关系`;
  // 2. 详情是非模态补充说明；使用 textContent 避免源文案变成 HTML。
  const node = current.nodes.find((item) => item.id === selected);
  element('detail-title').textContent = node?.title ?? '从一个模块开始';
  element('detail-text').textContent =
    node?.description ?? '点击任意节点，查看它的职责与直接关联。也可以用 Tab 和回车逐个探索。';
  element('detail-path').textContent =
    node?.path ??
    (current.id === 'system'
      ? '使用入口 → 业务编排 → 核心处理'
      : '简历与职位 → 匹配判断 → 人工行动');
  element('relation-title').textContent = node ? '直接关联' : '读图提示';
  const relations = element('relations');
  relations.replaceChildren();
  if (node) {
    for (const edge of current.edges.filter(
      (item) => item.from === selected || item.to === selected,
    )) {
      const next = required(
        current.nodes.find((item) => item.id === (edge.from === selected ? edge.to : edge.from)),
      );
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = `${edge.from === selected ? '→' : '←'} ${next.title} · ${edge.label}`;
      button.addEventListener('click', () => {
        select(next);
        stage.querySelector<HTMLButtonElement>(`[data-id="${next.id}"]`)?.focus();
      });
      relations.append(button);
    }
  } else {
    const tip = document.createElement('p');
    tip.textContent =
      '箭头表示运行时调用、数据访问或业务信息流，不表示代码导入关系。选择后，珊瑚色边线标记当前节点。';
    relations.append(tip);
  }
  (element('clear-selection') as HTMLButtonElement).disabled = !selected;
}

/** 再次点击当前节点取消选择，保持所有入口使用同一关系追踪状态。 */
function select(node: DiagramNode): void {
  selected = selected === node.id ? '' : node.id;
  refresh();
}

/** 缩放保留可视区域中心；滚动条是拖拽的可访问替代。 */
function setZoom(value: number, reset = false): void {
  // 1. 限制缩放范围，并记录旧中心在图坐标中的位置。
  const centerX = (viewport.scrollLeft + viewport.clientWidth / 2) / zoom;
  const centerY = (viewport.scrollTop + viewport.clientHeight / 2) / zoom;
  zoom = Math.max(0.55, Math.min(1.8, value));
  stage.style.transform = `scale(${String(zoom)})`;
  extent.style.width = `${String(1100 * zoom)}px`;
  extent.style.height = `${String(640 * zoom)}px`;
  // 2. 按新比例恢复视口，适应操作则回到左上角。
  viewport.scrollLeft = reset ? 0 : centerX * zoom - viewport.clientWidth / 2;
  viewport.scrollTop = reset ? 0 : centerY * zoom - viewport.clientHeight / 2;
  element('zoom-value').textContent = `${String(Math.round(zoom * 100))}%`;
  (element('zoom-out') as HTMLButtonElement).disabled = zoom <= 0.55;
  (element('zoom-in') as HTMLButtonElement).disabled = zoom >= 1.8;
}

/** 窄屏保持可读字号并允许横向滚动，桌面尽量完整容纳画布。 */
function fit(): void {
  setZoom(
    Math.max(0.75, Math.min(1, viewport.clientWidth / 1100, viewport.clientHeight / 640)),
    true,
  );
}

/** 切换已内嵌的视图，不发起网络请求，离线与慢网行为一致。 */
function showView(id: string): void {
  // 1. 仅选择构建期已校验的视图与可信模板。
  current = data.views.find((view) => view.id === id) ?? initialView;
  const template = element(`view-${current.id}`) as HTMLTemplateElement;
  stage.replaceChildren(template.content.cloneNode(true));
  selected = '';
  element('view-description').textContent = current.description;
  element('legend-entry').textContent = current.id === 'system' ? '入口' : '输入';
  element('legend-core').textContent = current.id === 'system' ? '应用能力' : '整理与核对';
  element('legend-contract').textContent = current.id === 'system' ? '核心处理' : '判断与制作';
  element('legend-infra').hidden = current.id !== 'system';
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-view]'))
    button.setAttribute('aria-pressed', String(button.dataset.view === current.id));
  // 2. 节点保留原生按钮键盘语义，详情内容不劫持焦点。
  for (const button of stage.querySelectorAll<HTMLButtonElement>('.node'))
    button.addEventListener('click', () => {
      select(required(current.nodes.find((node) => node.id === button.dataset.id)));
    });
  refresh();
  fit();
}

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-view]'))
  button.addEventListener('click', () => {
    showView(required(button.dataset.view));
  });
element('clear-selection').addEventListener('click', () => {
  selected = '';
  refresh();
});
element('zoom-in').addEventListener('click', () => {
  setZoom(zoom + 0.15);
});
element('zoom-out').addEventListener('click', () => {
  setZoom(zoom - 0.15);
});
element('fit').addEventListener('click', fit);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !event.isComposing) {
    selected = '';
    refresh();
  }
});
viewport.addEventListener('pointerdown', (event) => {
  if (
    event.pointerType !== 'mouse' ||
    event.button !== 0 ||
    (event.target as Element).closest('button')
  )
    return;
  drag = { x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
  viewport.setPointerCapture(event.pointerId);
  viewport.classList.add('dragging');
});
viewport.addEventListener('pointermove', (event) => {
  if (!drag) return;
  viewport.scrollLeft = drag.left + drag.x - event.clientX;
  viewport.scrollTop = drag.top + drag.y - event.clientY;
});
/** 鼠标释放、取消或丢失捕获均终止平移，避免卡住拖动状态。 */
function endDrag(): void {
  drag = undefined;
  viewport.classList.remove('dragging');
}
viewport.addEventListener('pointerup', endDrag);
viewport.addEventListener('pointercancel', endDrag);
viewport.addEventListener('lostpointercapture', endDrag);
element('theme').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme !== 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  element('theme').textContent = dark ? '切换浅色' : '切换深色';
  element('theme').setAttribute('aria-pressed', String(dark));
});
element('export').addEventListener('click', () => {
  // 1. 导出完整静态 SVG，不包含当前选择、脚本或网页交互控件。
  const template = element(`export-${current.id}`) as HTMLTemplateElement;
  const url = URL.createObjectURL(
    new Blob([template.innerHTML], { type: 'image/svg+xml;charset=utf-8' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `jobhunter-${current.id}.svg`;
  document.body.append(link);
  link.click();
  link.remove();
  // 2. 延迟释放下载对象，兼容需要异步读取 Blob 的浏览器。
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
  status.textContent = '已导出当前视图的完整浅色 SVG';
});
showView(current.id);
