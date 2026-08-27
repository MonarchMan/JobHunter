# JobHunter UX Contract

## Product context

- Audience: 使用本地 Web 管理台完成职位发现、匹配判断与运行诊断的个人求职者。
- Primary jobs: 建立画像、筛选职位、查看匹配证据、管理招聘来源、恢复失败任务。
- Target market(s): 中文本地个人使用场景。
- Active locales: `zh-CN`。
- Language/content register and native-review policy: 直接、克制、以用户对象为中心；技术标识只在诊断详情出现。
- Timezone/calendar policy: 沿用系统记录的 ISO 时间并用 `zh-CN` 格式显示，不改变领域时区语义。
- Accessibility target: WCAG 2.2 AA。

## Business-context sources

| Domain / scope     | Authoritative source                     | Source type | Reviewed date |
| ------------------ | ---------------------------------------- | ----------- | ------------- |
| Web 行为与安全     | `specs/011-web-console/spec.md`          | 产品规格    | 2026-08-24    |
| Web 技术与异步任务 | `specs/011-web-console/design.md`        | 技术设计    | 2026-08-24    |
| 删除与敏感数据     | `specs/013-resume-driven-intake/spec.md` | 产品规格    | 2026-08-24    |
| 进程与任务职责     | `docs/arch/worker-and-concurrency.md`    | 架构文档    | 2026-08-24    |
| UI 重设计          | `specs/014-ui-redesign/spec.md`          | 产品规格    | 2026-08-24    |

## Visual contract

- Project `DESIGN.md`: `DESIGN.md`。
- Token ownership model: 现有运行时 CSS 为规范所有者，`DESIGN.md` 镜像批准值。
- Runtime design-system/token source: `apps/web/app/styles/tokens.css` 中唯一的 `:root`。
- Mapping/export/adapters: `apps/web/app/styles.css` 按稳定顺序装配全局分片；CSS 变量直接供全局共享类和路由级 CSS Modules 消费，无生成适配器。
- Token drift gate: DESIGN lint、旧绿色/原始色值搜索、代表页面视觉验证。
- Supported themes: 仅亮色；强制颜色模式交给系统。
- Design-context owner/review policy: 修改共享视觉令牌时必须同步更新 `DESIGN.md`。

## Canonical UI Map

| Capability      | Canonical owner                 | Source of truth | Allowed variants           | Verification        |
| --------------- | ------------------------------- | --------------- | -------------------------- | ------------------- |
| Table Selection | `jobs-table.tsx` 职位批量选择   | 014 规格        | 桌面表格 / 移动记录卡      | E2E                 |
| Select/Listbox  | 原生 `select` + 全局字段样式    | 本契约          | native                     | 键盘 + 浏览器弹出层 |
| Combobox        | 共享 `CompanyCombobox`          | 014 规格        | authored                   | 键盘 + 弹层 + IME   |
| Date            | ISO 显示层 + 原生 `date` 交互层 | 014 规格        | native-picker / ISO-shell  | locale + E2E        |
| Form            | 页面表单 + 共享全局字段状态     | Schema 与本契约 | edit/upload/filter         | validation E2E      |
| Scrollbar       | 全局应用样式                    | DESIGN.md       | stable gutter 例外         | computed style      |
| Toast           | 当前不使用；持久内联反馈为规范  | 本契约          | success/warning/info/error | live-region test    |
| CRUD            | Route Handler + 应用服务        | 011/013 规格    | stay/queued                | full-flow E2E       |

## Component behavior

| Component    | Default        | Hover           | Focus            | Active         | Disabled       | Busy                  | Error             |
| ------------ | -------------- | --------------- | ---------------- | -------------- | -------------- | --------------------- | ----------------- |
| Button       | 明确强调/意图  | 颜色 + 1px 位移 | 3px 主色环       | scale 0.98     | 无事件、低对比 | 尺寸不变、文字/指示器 | 危险色 + 文字     |
| Icon button  | 有可访问名称   | 背景变化        | 同按钮           | 轻微缩放       | 同按钮         | 固定尺寸              | 同按钮            |
| Input        | 中性边框       | 边框加深        | 主色环           | n/a            | 只读视觉       | 提交控件拥有 pending  | 错误边框 + 说明   |
| Secret input | masked         | 同 Input        | 同 Input         | n/a            | 同 Input       | n/a                   | 不在 Toast 暴露值 |
| Search       | 非空时提供清除 | 同 Input        | 同 Input         | n/a            | 同 Input       | 保持尺寸              | 保留查询可恢复    |
| Textarea     | resize none    | 同 Input        | 同 Input         | n/a            | 同 Input       | 保留内容              | 内联错误          |
| Table/list   | 稳定行高       | 可操作行轻底色  | 行内控件可见焦点 | 无整行 pressed | n/a            | 框架稳定              | 内联错误/恢复     |

## Dataset navigation

- Admin tables: 服务端数字分页。
- Exploratory lists: 同样使用规格要求的数字分页，不使用无限滚动。
- URL state: 保存已提交搜索、筛选、排序和页码；敏感值不得进入 URL。
- Page size: 沿用服务端契约，职位优先 20 条，其他列表按现有分页 DTO。
- Empty/no-results/error/loading treatment: 保持列表框架或兼容最小高度，提供一个主要恢复行动。
- Back/scroll restoration: 返回时由 URL 恢复筛选和分页，浏览器恢复滚动。
- Selection scope: 职位列表仅选择当前页；批量评分明确显示所选数量。

## Flow ledger

| Operation             | Trigger                | Pending                    | Success destination  | Success feedback | Failure recovery   | Focus outcome                | Source ref |
| --------------------- | ---------------------- | -------------------------- | -------------------- | ---------------- | ------------------ | ---------------------------- | ---------- |
| Edit profile/settings | 保存按钮或设置控件     | 控件尺寸稳定并禁用重复提交 | 留在当前页           | 内联“已保存”     | 保留输入并显示错误 | 回到触发控件/首错字段        | 011        |
| Search/filter         | 应用筛选               | 保持列表框架               | 同列表 URL           | 结果总数         | 清除或修改筛选     | 返回筛选控件                 | 011        |
| Upload/background job | 文件选择/同步/匹配     | 立即显示已入队状态         | 留在当前上下文       | task ID 与状态   | 重试或前往任务详情 | 回到触发控件                 | 011/013    |
| Cancel task           | 取消按钮               | 禁止重复触发               | 留在任务列表         | 内联状态更新     | 可重试失败操作     | 回到操作按钮                 | 011        |
| Hard-delete resume    | 影响预览 + 输入 DELETE | 最终按钮 busy              | 留在资料页并跟踪任务 | 删除任务已创建   | 影响变化时重新预览 | 初始聚焦取消，失败回确认字段 | 011/013    |

## Navigation and responsive behavior

- Route document title policy: `{页面} — JobHunter`；错误和不存在页面使用真实中文标题。
- Route error / 403 page behavior: 保留应用壳层，提供返回工作台和相关列表的路径。
- Breadcrumb/tab/route-state policy: 只在真实层级使用返回/面包屑；路由级标签状态进入 URL。
- Sidebar/drawer/bottom-sheet transformation: 桌面侧边导航；窄屏顶部紧凑导航；长详情用抽屉而非底部表单。
- Responsive table strategy: 职位与任务在窄屏使用记录卡；需要横向比较的表格保留明确滚动区域。
- Truncation/full-value access: 表格长文本单行省略，鼠标悬浮或键盘聚焦显示完整值；技术 ID 可截短并在详情提供完整值。
- Focus restoration and sticky-obstruction policy: 弹层关闭回到触发控件，固定导航不得遮住聚焦内容。

## Overlays and feedback

- Dialog primitive: 现有应用内 `dialog`，继续统一焦点、Escape、滚动锁定和恢复。
- Destructive confirmation levels: 简历硬删除保留影响预览与输入确认；普通可恢复操作不追加确认。
- Toast placement/duration/deduplication: 当前不使用瞬时 Toast，关键反馈使用持久内联状态。
- Alert/banner scope and persistence: 字段问题内联、页面问题在内容标题下、全局不可用才使用壳层横幅。
- Tooltip delay/dismissal: 仅用于非通用图标，键盘聚焦可见，Escape 可关闭。
- Unsaved-changes behavior: 在线简历以客户端草稿承载未保存内容；预览读取草稿。当前离页使用浏览器生命周期提示，后续共享路由拦截器可替换为应用内确认。
- Layer/z-index contract: dialog > drawer > popover > inline feedback；评分 popover 使用页面顶层 portal，不能改变表格行高或被滚动容器裁切。
- Profile resume workbench: 在线简历章节使用稳定锚点，目录可横向滚动；重复条目可增删。底部粘性操作条一次保存完整资料并生成单一版本。预览使用 portal 模态弹窗，读取未保存草稿、过滤空条目和空章节，内部滚动，Escape 关闭并恢复触发按钮焦点；同一导入控件接受 PDF/DOCX 与 JPEG/PNG，图片明确标记为 Worker 后台 OCR，不另设重复入口。
- Profile date inputs: 经历、项目、竞赛和证书日期使用原生 `date`；接受 Edge/Chrome 平台弹层的本地化、月/年切换和键盘行为。起止时间额外使用应用拥有的只读 ISO 表面，透明原生输入仍是实际交互与无障碍所有者，应用不仿制日历弹层。
- Profile date ranges: 教育、工作和项目的开始/结束日期由同一字段组拥有；桌面端该组占一列（半行，外宽与普通字段一致），内部两个日期等宽同排，移动端扩为整行；应用表面固定显示 `YYYY-MM-DD`，旧的月份值载入时补齐为当月首日，保存值统一为完整 ISO 日期字符串。标题沿用普通字段的正常字重、行高和标签间距，日期控件顶边与同行普通输入框对齐。
- Job title navigation: 职位列表的职位名称直接使用 `detailUrl` 在安全新标签页打开官网详情；站内 `/jobs/[id]` 是诊断详情而非列表默认落点，其历史修订读取必须兼容数组式和对象式 change set。
- Professional skills: 在线简历用单一多行文本编辑和预览“专业技能”；解析得到的结构化 `skills`/`domains` 继续供匹配使用，不在表单拆成大量重复项。

## Async and resilience

- Mutation default: 悲观提交；耗时操作仅入队。
- Idempotency and duplicate-submit policy: mutation 使用现有 CSRF/idempotency，提交期间禁用重复触发。
- Auto-save/draft recovery: 当前设置即时保存，在线简历显式整份保存；失败与版本冲突均保留客户端输入，不自动覆盖新版本。
- Offline/read-stale/write behavior: 离线写入失败并保留上下文，不伪造成功。
- Retry/backoff/timeout behavior: 使用现有任务策略；UI 只展示真实状态和可用重试。
- Version conflict and multi-tab behavior: 画像更新沿用版本条件，冲突时重新加载并保留可复制输入。
- Session expiry/re-authentication: 当前本地单用户，无登录会话。
- Long-running progress and return path: 页面显示任务状态，并链接到任务诊断。
- Source company card: 官网来源按 companyId 一家公司一卡；桌面端每行两张，860px 以下单列，卡片不随同排较高卡片拉伸。公司名称右侧使用原生单选下拉框，“全部”聚合视图始终存在，实习/校招/社招仅在实际接入时出现。多渠道公司的“全部”使用独立公司总览，不渲染具体渠道详情；只有选择具体渠道时才出现该渠道运行与高级设置。“全部”和具体渠道内容区使用一致的尺寸基线，切换不引起卡片明显跳变。公司名称以安全的新标签链接到当前选择对应的官方招聘入口；“立即同步”固定在右上角、综合状态左侧，并同步当前选择范围（“全部”表示全部启用来源）；公司综合健康取最差渠道状态，渠道切换不改变 URL。
- Stale-request cancellation/invalidation and pending-state ownership: 刷新由页面级单一所有者控制，页面隐藏时暂停。
- Dialog/form preservation and retry after mutation failure: 保持输入和弹层上下文，错误可再次提交。

## Validation

- Schema/validation layer: Route Handler 与应用 DTO 的 Zod Schema，客户端负责可读字段反馈。
- Trigger timing: 提交时验证，必要字段可在失焦后显示。
- Error summary/inline policy: 字段错误内联；页面级错误包含稳定恢复入口。
- Server error mapping: 使用稳定 code、用户 message 和 correlationId，不显示堆栈。
- Sensitive-value handling: 简历和密钥不进入 URL、Toast、日志或非必要客户端存储。
- Forms 使用 `noValidate`；阻止重复提交；失败保留输入并聚焦首个错误。

## Permission and clipboard

- Permission UI strategy: 当前本地单用户无角色权限；不可用能力基于系统状态禁用并解释原因。
- Clipboard copy policy: 技术 ID 显示短预览并允许显式复制，反馈不重复敏感值。
- Disabled-state explanation: 非显然原因通过邻近文字或可聚焦说明提供。

## Migration status

- Migration ledger location: `specs/014-ui-redesign/tasks.md`。
- Canonical primitives and owners: `DESIGN.md`、本契约、`styles/tokens.css`、全局样式分片、组件级 CSS Modules 和 `apps/web/app/components`。
- Current risk-prioritized slices: 页面级样式迁移已完成；后续新增页面必须复用现有共享所有者或使用就近 CSS Module。
- Legacy import/token enforcement: 搜索旧绿色直接值、重复 `:root`、原生对话框和页面级反馈色。
- Rollout/rollback and removal gates: 按完整页面工作流迁移，测试失败时可按页面回退，不保留双主题长期分支。

## Verification

- Required static commands: Premium strict audit、`pnpm format:check`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm docs:check`。
- Browser/device/locale/theme matrix: zh-CN 亮色，1280px、768px、390px，正常/减少动态效果。
- Accessibility checks: Playwright + axe、键盘路径、焦点恢复、对比度和语义检查。
- Component-state/visual regression coverage: 工作台、职位、来源、任务、资料、设置代表状态。
- Canonical sibling flow used for comparison: 职位筛选/分页和任务筛选/分页。
- Project audit command/result: 实施完成后记录。
- CRUD full-flow evidence: `apps/web/test/browser/core.e2e.spec.ts`。
- Failure-path evidence: `apps/web/test/browser/accessibility.spec.ts` 与路由 E2E。
