# 字节跳动官网来源

- 复核日期：`2026-08-22`
- 入口：<https://jobs.bytedance.com/experienced/position?limit=100>
- 状态：`supported`，默认启用
- 证据：匿名 Edge/Chromium 会话加载官网页面后，由官网自身前端生成运行时 `_signature` 并返回 `data.job_post_list`、`data.count`；`limit=100` 时返回约 `10000` 个职位，分页请求的 `offset` 已在两页 Smoke 中校验。
- 契约样本：`test/fixtures/bytedance/collection.json`，SHA-256 `96e086f7bf28935f8601912a5be5fc7cb895b6f96ba0e17c779b65637d0a77b3`；包含两页分页边界，逐来源 Zod 记录 Schema 和公共来源契约测试已启用。
- 采集：适配器只驱动官网分页控件并读取同一浏览器会话中的 200 响应，不复制 Cookie、CSRF 或签名；按 `ceil(count / limit)` 计算覆盖范围，稳定 ID 和官方 `/experienced/position/{id}/detail` 链接通过归一化测试。
- 边界：出现验证码、登录或访问验证时返回 `access_blocked`；浏览器运行时可通过 `JOBHUNTER_BROWSER_EXECUTABLE` 或本机 Edge/Chrome 探测配置。
