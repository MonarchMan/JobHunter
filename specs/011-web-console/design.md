# 011 本地 Web 管理台设计

> 状态：Implemented

## 技术结构

`apps/web` 使用 Next.js App Router。Server Components 负责初始查询，Route Handlers 调用应用层 command/query；浏览器端不直接访问 SQLite。耗时 command 返回 202 + task DTO。

```text
apps/web/app/
├─ page.tsx
├─ jobs/
├─ profile/
├─ sources/
├─ tasks/
├─ agent-runs/
├─ settings/
└─ api/
```

## 运行时编排

`apps/web/src/server/main.ts` 是本地 Web 启动器。它以两个相互独立的子进程启动 Next.js Web 服务和 `apps/worker/src/main.ts` Worker；Web 进程只提供页面、查询和入队接口，Worker 负责领取并执行耗时任务。任一子进程异常退出时，启动器会停止另一个进程；收到 SIGINT/SIGTERM 时，会将信号转发给两个子进程并清理资源。

开发模式通过仓库级 `tsx` 执行 Worker TypeScript 入口，生产模式执行 `apps/worker/dist/main.js`。因此启动 Web 管理台即可获得完整的入队与执行链路，不需要另开终端手动启动 Worker。CLI 独立启动 Worker 仍作为无 Web 场景和调试场景的入口。

共享 DTO/Schema 位于 `packages/application/contracts`，不把领域实体直接序列化给 UI。

主要 Route Handler：

| 方法与路径                                                | 用途                       |
| --------------------------------------------------------- | -------------------------- |
| `GET /api/dashboard`                                      | 健康与任务摘要             |
| `GET /api/jobs`、`GET /api/jobs/:id`                      | 职位分页与详情             |
| `GET /api/profile`、`PATCH /api/profile`                  | 当前画像与带版本条件的修改 |
| `GET /api/profile/versions`                               | 画像历史                   |
| `GET /api/sources`                                        | 来源与最近运行             |
| `POST /api/sources/:id/sync`                              | 幂等入队同步               |
| `GET /api/tasks`、`GET /api/tasks/:id`                    | 任务查询                   |
| `POST /api/tasks/:id/retry`、`POST /api/tasks/:id/cancel` | 任务操作                   |
| `GET /api/agent-runs/:id`                                 | 脱敏 Agent 运行详情        |
| `GET/POST /api/resumes/:id/deletion`                      | 删除影响预览/确认入队      |
| `GET/PATCH /api/settings`                                 | 读取/修改非敏感系统设置    |

所有响应使用统一 envelope：`{ data, meta?, error? }`；错误包含稳定 code、用户可读 message 和 correlationId，不返回堆栈。

## 列表分页契约

所有 Web 列表返回统一的分页元数据：

```ts
{
  items: T[],
  page: { current: number, total: number, totalPages: number, pageSize: number },
  hasPreviousPage: boolean,
  hasNextPage: boolean
}
```

页面 URL 使用 `page`（任务和 Agent 运行分别使用 `taskPage`、`agentPage`）。数据查询采用稳定排序的 `LIMIT/OFFSET` 与总数查询；旧的内部游标查询仍可供 CLI/导出流程使用。页码控件始终显示首页、末页和当前页附近页码，省略区间使用省略号。

## 页面信息架构

- Dashboard：健康与待办摘要。
- Jobs：左/顶部筛选、结果表、详情页；分数采用数字和文字，不只靠颜色；确定性 MatchResult 与版本化 MatchAdvice 分区展示，建议失败不影响分数。
- Profile：版本选择、字段差异、偏好和锁定。
- Sources：总页标题为“招聘来源”，通过“官网来源 / 招聘平台来源”二级菜单分组。官网来源先按稳定 companyId 聚合并按公司分页，一家公司一张卡；桌面端每行两张公司卡片，860px 以下回落为单列，卡片不为同排较高内容强制拉伸。公司名称右侧使用原生单选下拉框呈现“全部”和已接入的实习/校招/社招渠道，未接入渠道不渲染。多渠道公司选择“全部”时只显示一张独立总览，汇总接入渠道、启用来源、健康来源和最近成功时间；选择具体渠道后才展示该渠道的运行统计与高级设置。两类视图复用同一内容区尺寸基线，避免切换时卡片跳变。“立即同步”固定在卡片右上角、综合状态左侧；具体渠道只同步当前渠道，“全部”同步该公司当前启用的全部来源。公司名称链接到当前选择对应来源的官方招聘入口，并以安全的新标签打开。公司综合状态采用最差健康状态。招聘平台来源在未接入时保留明确空状态。
- Tasks/Agent Runs：诊断和重试。任务与 Agent 运行分别使用独立的 `taskPage`、`agentPage` 页码；点击任一项目使用 dialog 弹出详情，失败时展示错误类别、脱敏失败原因、尝试次数和时间线，Agent dialog 通过详情 API 加载工具调用。
- Settings：修改非敏感系统设置；职位理解关闭时不清理历史任务。

## 数据与安全

所有 mutation 使用 POST/PATCH，先从只读 CSRF 端点取得随机 token，并同时以 `SameSite=Strict`、`HttpOnly` Cookie 和自定义请求头回传；服务端校验二者恒等、Origin/目标协议与端口一致且均为 loopback，即使首期无账户也拒绝跨站写入。服务端启动强制 host 为 127.0.0.1/::1/localhost。外链限定数据库中已验证的官方 HTTPS URL，并使用 `target=_blank rel="noopener noreferrer"`。敏感简历删除先返回稳定影响 hash 和数量，用户输入 `DELETE` 二次确认后只入队 Worker 任务；执行前再次计算影响，变化时要求重新预览。

## 更新策略

首期使用 2–5 秒退避轮询活动任务，不引入 WebSocket。页面 action 使用服务端 idempotency token，浏览器重试返回同一 task。

## 测试

- 组件：筛选、状态、分项和错误显示。
- Route Handler：Schema、状态码、幂等和禁止直接长任务。
- Playwright E2E：核心六个验收场景，使用 FakeAdapter/FakeModel 和临时数据库。
- axe 基础无障碍扫描 + 键盘路径人工验证。
