# 得物官网来源

- 复核日期：`2026-08-22`
- 入口：<https://poizon.jobs.feishu.cn/578078/position/list?limit=100>
- 状态：`supported`，默认启用
- 证据：匿名 Edge/Chromium 会话加载校招/实习筛选页面后，由官网自身前端生成运行时 `_signature`；列表返回 `data.job_post_list`、`data.count=6`，`limit=100` 时 1 页完整返回 6 个岗位。
- 采集：浏览器会话初始化时捕获官网首个 JSON 请求的必要上下文，后续在同一页面上下文中直接复用会话、请求头和签名模板发送 JSON 分页请求，不解析职位 DOM、不点击 DOM 分页；稳定 ID、官方 `/578078/position/{id}/detail` 链接和字段归一化通过 Smoke 与契约测试。
- 契约样本：`test/fixtures/dewu/duplicate-collection.json`，SHA-256 `aa07657f02e47bb3182a9141244774db40333d2fdece30d3454750666e301ee8`；覆盖重复稳定 ID 必须降级 `partial`，逐来源 Zod 记录 Schema 和公共来源契约测试已启用。
- 边界：出现登录、验证码或访问验证时返回 `access_blocked`；浏览器运行时可通过 `JOBHUNTER_BROWSER_EXECUTABLE` 或本机 Edge/Chrome 探测配置。
