---
version: alpha
name: 'JobHunter'
description: '以档案靛蓝、克制动效和决策光标构成的本地个人求职工作台'
colors:
  ink: '#1C2130'
  ink-muted: '#596275'
  canvas: '#F5F6FA'
  canvas-tint: '#EEF1FB'
  surface: '#FFFFFF'
  line: '#DEE2EC'
  primary: '#4E5FBB'
  primary-hover: '#3F4E9A'
  primary-soft: '#E9ECFF'
  action: '#E06C5D'
  action-soft: '#FDECE9'
  success: '#236A8D'
  success-soft: '#E6F3F8'
  warning: '#8F5B0C'
  warning-soft: '#FFF3D8'
  danger: '#A13D32'
  danger-soft: '#FCEBE8'
  neutral-soft: '#EEF0F4'
typography:
  sans:
    fontFamily: 'Inter, Noto Sans SC, Microsoft YaHei UI, system-ui, sans-serif'
  mono:
    fontFamily: 'IBM Plex Mono, SFMono-Regular, Consolas, monospace'
rounded:
  DEFAULT: '0.5rem'
  sm: '0.375rem'
  md: '0.5rem'
  lg: '0.75rem'
spacing:
  control-gap: '0.75rem'
  panel-gap: '1.25rem'
  section-gap: '2.5rem'
  page-max: '90rem'
components:
  button: {}
  field: {}
  status-badge: {}
  panel: {}
  table: {}
  dialog: {}
  drawer: {}
---

# JobHunter Design System

## Overview

### Creative North Star

JobHunter 像一套正在整理中的个人求职档案：信息可信、分类明确、可以随时继续处理。深靛蓝来自档案墨水与批注工具，珊瑚色决策光标只指出当前最值得做的一件事。

### Product context and register

- **Audience and primary job:** 在中文桌面环境中管理简历、官网职位、匹配和后台任务的个人求职者。
- **Target market(s) and evidence:** 当前产品规格面向中文本地个人使用，见 `README.md` 与 `specs/011-web-console/spec.md`。
- **Locale(s) and language policy:** `zh-CN`；产品文案使用直接、克制的中文，技术标识仅在诊断详情展示。
- **Usage scene:** 以 1280px 以上桌面高频筛选和比较为主，同时支持 390px 移动端核心浏览与操作。
- **Register:** 产品型工作台；仅首页 Hero 保留有限品牌表达。
- **Memorable signature:** 3px 珊瑚色“决策光标”，只标记下一步行动、核心判断或首要恢复入口。
- **Restraint:** 表格、表单、设置与诊断界面优先熟悉度、密度和稳定性。
- **Anti-references:** 不使用绿色品牌后台、荧光 AI 科技风、玻璃拟态、大面积渐变和所有内容卡片化。
- **Token ownership/runtime mapping:** `apps/web/app/styles/tokens.css` 是运行时唯一令牌源，`apps/web/app/styles.css` 只负责按稳定顺序装配全局分片；本文件镜像并解释同一组批准值。变更必须同步修改令牌源与本文件，并运行设计 lint、颜色搜索和浏览器视觉验证。

## Colors

`primary` 档案靛蓝用于主要操作、当前导航和焦点关联；`action` 珊瑚色只用于决策光标和少量下一步强调。品牌和成功语义均不得使用绿色。成功、警告、失败分别使用蓝青、琥珀和红色，并始终配合文字或图标。

页面外层底色使用 `canvas-tint`，内容画布使用 `canvas`，工作面板使用 `surface`，以三层接近色建立稳定纵深；层级继续主要依赖 `line`、间距和排版。选择与轻反馈使用 `primary-soft`，禁止把主色软背景铺满大面积页面。

## Typography

中文与控件使用 sans 栈，英文数字沿用同一字体度量；UUID、Token、版本和成本使用 mono 栈。正文基准 16px/1.6，密集表格为 14px/1.45。工作页面 H1 为 36px，移动端 30px；首页 Hero 是唯一可使用 56–64px 的位置。中文标题不使用装饰性斜体或过度字距。

## Layout

桌面壳层使用约 14rem 侧边导航。表格/诊断页最大宽度 90rem，详情页 60–70rem，表单页 40–48rem。页面使用自然文档滚动；只有明确的表格或弹层内部拥有局部滚动。加载和错误状态预留兼容几何，禁止通过固定整个页面高度来让表格填屏。

1024px 以下导航转为顶部布局；600px 以下减少可见入口但保持全部入口可达。移动端数据表根据比较需求选择横向滚动或记录卡，不能只缩小桌面表格。

## Elevation & Depth

静态面板默认使用细边框，不加阴影。导航、下拉列表、抽屉、对话框、Toast 等浮层使用统一柔和阴影；应用拥有的下拉列表使用 `--z-dropdown` 层级并通过 portal 避免被筛选面板裁切。hover 可上移 1px，但不得让普通静态卡片持续漂浮。

## Shapes

控件使用 8px 圆角，面板与弹层使用 12px，状态标签使用 6px。完整胶囊形只用于极短、独立的计数或切换，不作为通用按钮形状。

## Components

### Foundational visual states

交互控件必须覆盖默认、hover、focus-visible、pressed、disabled、busy 和 error。焦点使用主色外环并与边框保持间隔；disabled 降低对比并禁止指针事件；busy 保持原尺寸。加载使用固定尺寸指示器，背景刷新不替换整个内容面板。

### Buttons and actions

按钮使用 emphasis（solid/outline/ghost）与 intent（brand/neutral/danger）两轴。普通页面只允许一个高强调主操作，危险实心按钮只出现在最终确认中。hover 为 120ms 颜色变化和最多 1px 位移，pressed 为 `scale(0.98)`。

同一操作组中，保存使用实心品牌强调；预览、关闭预览和返回编辑使用中性 outline，hover 仅切换浅灰背景、深色文字和边框，不能继承实心品牌按钮背景。

### Navigation and data display

桌面使用侧边导航，窄屏使用紧凑顶部导航。活动项通过浅靛蓝背景和决策光标表达。表格保持语义 HTML、稳定分页和 URL 状态；移动端记录卡必须保留状态、排序和同等操作。

### Forms and overlays

单选控件按弹层几何所有权选择变体：可接受平台弹层时使用原生 `select`；当宽度、边框、间距或碰撞位置必须与页面契约一致时，使用共享 authored `SelectField`。其触发框和弹层必须等宽、消费同一边框与圆角令牌，并默认在触发框下方展开。表单拥有应用内验证和稳定错误区域。对话框用于确认与短任务，抽屉用于长详情；弹层关闭后恢复触发控件焦点。

个人资料使用“在线简历工作台”变体：导入入口在前，正文以长表单承载可编辑章节和重复经历；宽屏章节目录在编辑区右侧 sticky 定位，可收起为窄恢复入口，并以浅靛蓝背景和珊瑚色决策光标标记当前章节；窄屏目录转为顶部横向 sticky 快速定位。底部粘性操作条保持“预览 / 保存”可达。预览使用浮于页面的档案纸张式模态弹窗，弹窗内部独立滚动；该变体沿用全局面板、令牌和自然文档滚动，不引入独立品牌色。

在线简历的 AI 润色入口使用紧凑工具条式面板：白色表面与细边框保持安静，3px 珊瑚色决策光标标记这一下一步操作；标题、目标岗位和事实边界形成一行，润色范围与主操作形成一行。建议生成前不得用大面积主色软背景或固定高度制造空白，生成后才展开预览内容。

在线简历字段正文使用 16px 基准、章节标题约 18px，辅助说明不低于 14px。章节 hover 与 `focus-within` 使用浅画布底色和靛蓝软边框建立当前编辑上下文，不增加位移或阴影。起止日期组在桌面端与普通字段一样只占半行，可见界面只保留正常字重的组标题和两个等宽同排日期控件；组标题与所有字段标签统一使用 `0.45rem` 标签—控件间距，控件表面固定显示 `YYYY-MM-DD` 并由透明原生日历输入承载交互；“专业技能”使用连续文本，避免标签或重复卡片造成视觉碎片。

### Iconography

使用一致的 1.75px 线性 SVG 图标，常用尺寸 18px 和 20px。非通用图标必须保留文字或可访问名称，禁止混用 emoji 作为产品图标。

### Motion

快速反馈 120ms、内容变化 180ms、弹层 260ms；使用统一 ease-out 和 standard 曲线。动效只解释进入、展开、更新和完成，优先使用 opacity 与 transform。支持减少动态效果，禁止持续循环的装饰动画。

### Content and data visualization

界面从用户可控制的对象出发命名，例如“来源同步”而不是 `source.sync`。按钮动词与反馈保持一致。错误说明发生了什么及下一步，空状态只给一个主要行动。

## Do's and Don'ts

- **Do:** 用决策光标突出真正的下一步，并让其余界面保持安静。
- **Do:** 让表格、筛选、分页和返回在跨页面行为上保持一致。
- **Don't:** 重新引入绿色品牌色、成功色或硬编码旧绿色值。
- **Don't:** 用渐变、阴影、圆角和动画堆叠掩盖信息架构问题。
