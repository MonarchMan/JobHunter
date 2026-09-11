/** 架构文档的固定画布尺寸；HTML 与 SVG 共用，防止节点和连线漂移。 */
export const WIDTH = 1100;
export const HEIGHT = 640;
export const NODE_WIDTH = 220;
export const NODE_HEIGHT = 96;

/** 将经过校验的必需值收窄为非空类型，缺失时给出可诊断错误。 */
export function required<T>(value: T | null | undefined): T {
  if (value === undefined || value === null) throw new Error('架构数据缺少必需值');
  return value;
}

/** 节点的语义分类，同时用于文字图例和令牌映射。 */
export type Kind = 'entry' | 'core' | 'contract' | 'infra' | 'human';
/** 可编辑 JSON 的节点；path 是仓库相对路径，不是任意 URL。 */
export interface DiagramNode {
  id: string;
  kind: Kind;
  title: string;
  subtitle: string;
  path: string;
  description: string;
  x: number;
  y: number;
}
/** 有向关系；implementation 使用虚线表示实现端口。 */
export interface Edge {
  from: string;
  to: string;
  label: string;
  type?: 'implementation';
  /** 平行跨行连线的标签垂直偏移，用于避免说明文字重叠。 */
  labelDy?: number;
}
/** 一个自洽的架构或流程视图。 */
export interface DiagramView {
  id: string;
  title: string;
  description: string;
  lanes: string[];
  nodes: DiagramNode[];
  edges: Edge[];
}
/** 构建时校验的文档结构。 */
export interface Diagram {
  version: 1;
  title: string;
  views: DiagramView[];
}

/** 校验未知对象，避免构建时信任手工维护的 JSON。 */
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('架构数据必须是对象');
  }
  return value as Record<string, unknown>;
}

/** 拒绝空文本和不合理的长字段，保留完整详情的较大上限。 */
function string(value: unknown, max = 600): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new Error('架构字段必须是非空且长度受限的文本');
  }
}

/** JSON 数据入口：检查版本、唯一 ID、节点边界和边引用后返回类型化数据。 */
export function validateDiagram(value: unknown): Diagram {
  // 1. 校验文档及视图，限制数据规模以保持离线页面可控。
  const doc = record(value);
  string(doc.title, 80);
  if (doc.version !== 1 || !Array.isArray(doc.views) || !doc.views.length || doc.views.length > 8) {
    throw new Error('不支持的架构版本或视图数量');
  }
  const viewIds = new Set<string>();
  for (const rawView of doc.views) {
    const view = record(rawView);
    string(view.id, 40);
    if (!/^[a-z][a-z0-9-]*$/.test(view.id) || viewIds.has(view.id))
      throw new Error('视图 ID 无效或重复');
    viewIds.add(view.id);
    string(view.title, 40);
    string(view.description);
    if (!Array.isArray(view.lanes) || view.lanes.length !== 4) throw new Error('需要四列分层标题');
    view.lanes.forEach((lane) => {
      string(lane, 30);
    });
    if (
      !Array.isArray(view.nodes) ||
      !view.nodes.length ||
      view.nodes.length > 40 ||
      !Array.isArray(view.edges) ||
      view.edges.length > 100
    )
      throw new Error('节点或关系数量无效');
    const ids = new Set<string>();
    for (const rawNode of view.nodes) {
      // 2. ID 和路径仅接受安全字符；坐标必须落在画布内。
      const node = record(rawNode);
      string(node.id, 60);
      if (!/^[a-z][a-z0-9-]*$/.test(node.id) || ids.has(node.id))
        throw new Error('节点 ID 无效或重复');
      ids.add(node.id);
      string(node.title, 24);
      string(node.subtitle, 60);
      string(node.description);
      string(node.path, 180);
      if (
        !/^(apps|packages|docs)(\/[a-zA-Z0-9_.-]+)*$/.test(node.path) ||
        node.path.split('/').some((part) => part === '..')
      )
        throw new Error('仓库路径无效');
      if (!['entry', 'core', 'contract', 'infra', 'human'].includes(String(node.kind)))
        throw new Error('节点分类无效');
      for (const [axis, max] of [
        ['x', WIDTH - NODE_WIDTH],
        ['y', HEIGHT - NODE_HEIGHT],
      ] as const) {
        if (
          typeof node[axis] !== 'number' ||
          !Number.isFinite(node[axis]) ||
          node[axis] < 0 ||
          node[axis] > max
        )
          throw new Error('节点超出画布');
      }
    }
    const pairs = new Set<string>();
    for (const rawEdge of view.edges) {
      // 3. 所有连线都必须引用当前视图的真实节点。
      const edge = record(rawEdge);
      string(edge.from);
      string(edge.to);
      string(edge.label, 24);
      const key = `${edge.from}:${edge.to}`;
      if (!ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to || pairs.has(key))
        throw new Error('关系引用无效或重复');
      if (edge.type !== undefined && edge.type !== 'implementation')
        throw new Error('关系类型无效');
      if (
        edge.labelDy !== undefined &&
        (typeof edge.labelDy !== 'number' ||
          !Number.isFinite(edge.labelDy) ||
          Math.abs(edge.labelDy) > 80)
      )
        throw new Error('连线标签偏移无效');
      pairs.add(key);
    }
  }
  return value as Diagram;
}

/** 对 HTML 文本和属性统一转义，JSON 文案不能注入页面结构。 */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** 正交连线从节点边界出发，返回路径及标签中点。 */
export function edgeGeometry(
  view: DiagramView,
  edge: Edge,
): { path: string; x: number; y: number } {
  // 1. 引用由入口验证，生成器与测试仍显式拒绝缺失节点。
  const from = view.nodes.find((node) => node.id === edge.from);
  const to = view.nodes.find((node) => node.id === edge.to);
  if (!from || !to) throw new Error('连线节点不存在');
  // 2. 同列用垂直线，其余在列间转折，避免穿过卡片正文。
  if (from.x === to.x) {
    const down = to.y > from.y;
    const x = from.x + NODE_WIDTH / 2;
    const y1 = from.y + (down ? NODE_HEIGHT : 0);
    const y2 = to.y + (down ? 0 : NODE_HEIGHT);
    // 2.a. 跨行关系绕开中间卡片，避免暗示信息必须经过该无关模块。
    const blocked = view.nodes.some(
      (node) =>
        node.id !== from.id &&
        node.id !== to.id &&
        node.x === from.x &&
        node.y < Math.max(y1, y2) &&
        node.y + NODE_HEIGHT > Math.min(y1, y2),
    );
    if (blocked) {
      const gutter = Math.max(5, from.x - 25);
      const start = down ? from.y + NODE_HEIGHT : from.y;
      const turn = start + (down ? 24 : -24);
      const end = to.y + NODE_HEIGHT / 2;
      return {
        path: `M ${String(x)} ${String(start)} V ${String(turn)} H ${String(gutter)} V ${String(end)} H ${String(to.x)}`,
        x: gutter,
        y: down ? to.y - 28 : to.y + NODE_HEIGHT + 28,
      };
    }
    return { path: `M ${String(x)} ${String(y1)} V ${String(y2)}`, x: x + 23, y: (y1 + y2) / 2 };
  }
  const right = to.x > from.x;
  const x1 = from.x + (right ? NODE_WIDTH : 0);
  const x2 = to.x + (right ? 0 : NODE_WIDTH);
  const y1 = from.y + NODE_HEIGHT / 2;
  const y2 = to.y + NODE_HEIGHT / 2;
  // 3. 相邻关系分配不同转折轨道，避免重叠线段被误读为新的依赖。
  const track = ((view.edges.indexOf(edge) % 3) - 1) * 10;
  const middle = (x1 + x2) / 2 + track;
  return {
    path: `M ${String(x1)} ${String(y1)} H ${String(middle)} V ${String(y2)} H ${String(x2)}`,
    x: y1 === y2 ? (x1 + x2) / 2 : middle,
    y: (y1 + y2) / 2 - 9 + (edge.labelDy ?? 0),
  };
}
