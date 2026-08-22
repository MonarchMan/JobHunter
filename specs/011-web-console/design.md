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
└─ api/
```

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

所有响应使用统一 envelope：`{ data, meta?, error? }`；错误包含稳定 code、用户可读 message 和 correlationId，不返回堆栈。

## 页面信息架构

- Dashboard：健康与待办摘要。
- Jobs：左/顶部筛选、结果表、详情页；分数采用数字和文字，不只靠颜色；确定性 MatchResult 与版本化 MatchAdvice 分区展示，建议失败不影响分数。
- Profile：版本选择、字段差异、偏好和锁定。
- Sources：总页标题为“招聘来源”，通过“官网来源 / 招聘平台来源”二级菜单分组；官网来源展示支持状态、计划、运行历史，招聘平台来源在未接入时保留明确空状态。
- Tasks/Agent Runs：诊断和重试。

## 数据与安全

所有 mutation 使用 POST/PATCH，先从只读 CSRF 端点取得随机 token，并同时以 `SameSite=Strict`、`HttpOnly` Cookie 和自定义请求头回传；服务端校验二者恒等、Origin/目标协议与端口一致且均为 loopback，即使首期无账户也拒绝跨站写入。服务端启动强制 host 为 127.0.0.1/::1/localhost。外链限定数据库中已验证的官方 HTTPS URL，并使用 `target=_blank rel="noopener noreferrer"`。敏感简历删除先返回稳定影响 hash 和数量，用户输入 `DELETE` 二次确认后只入队 Worker 任务；执行前再次计算影响，变化时要求重新预览。

## 更新策略

首期使用 2–5 秒退避轮询活动任务，不引入 WebSocket。页面 action 使用服务端 idempotency token，浏览器重试返回同一 task。

## 测试

- 组件：筛选、状态、分项和错误显示。
- Route Handler：Schema、状态码、幂等和禁止直接长任务。
- Playwright E2E：核心六个验收场景，使用 FakeAdapter/FakeModel 和临时数据库。
- axe 基础无障碍扫描 + 键盘路径人工验证。
