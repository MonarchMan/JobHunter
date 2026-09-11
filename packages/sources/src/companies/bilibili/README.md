# 哔哩哔哩官网来源

`bilibili.social@1.0.0` 使用 [新官网社招入口](https://jobs.bilibili.com/social/positions)，在 SourcePageClient 的匿名浏览器会话中读取公开 JSON。无浏览器时返回 access_blocked；不需要账号或候选人 Cookie。

列表已内联职责与要求，不逐职位请求详情。稳定 ID 为官方 id，深链为 `/social/positions/<id>`。仅保留公开字段，HTML 转纯文本，pushTime 按 Asia/Shanghai 解释；校招/实习记录不会混入。

默认每页 50 条、JSON 请求至少间隔 5 秒。UI 首屏容量为 10 时重放首页，再按 total 和请求容量分页；不采信响应 pages/size。重复 ID、短页、缺页、总数漂移或采样均保持 partial；健康检查只取一页。

定向在线验证（默认跳过）：

```sh
JOBHUNTER_ONLINE_SOURCES=1 JOBHUNTER_ONLINE_SOURCE=bilibili-social pnpm exec vitest run --project online apps/worker/test/bilibili-social.online.test.ts
```

测试使用真实生产适配器和 Worker 浏览器客户端，最多三次列表请求（UI 首屏、配置容量首页、末页）及一条详情。已通过 2026-09-11 门禁，catalog 物理来源默认启用；社招逻辑渠道开关仍遵循既有默认规则，seed 不覆盖用户已有开关。校招和实习尚未接入。
