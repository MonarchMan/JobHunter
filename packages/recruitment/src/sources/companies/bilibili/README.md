# 哔哩哔哩官网来源

`bilibili.social@1.0.0` 使用 [新官网社招入口](https://jobs.bilibili.com/social/positions)，在 SourcePageClient 的匿名浏览器会话中读取公开 JSON。无浏览器时返回 access_blocked；不需要账号或候选人 Cookie。

列表已内联职责与要求，不逐职位请求详情。稳定 ID 为官方 id，深链为 `/social/positions/<id>`。仅保留公开字段，HTML 转纯文本，pushTime 按 Asia/Shanghai 解释；校招/实习记录不会混入。

默认每页 50 条、JSON 请求至少间隔 5 秒。UI 首屏容量为 10 时重放首页，再按 total 和请求容量分页；不采信响应 pages/size。重复 ID、短页、缺页、总数漂移或采样均保持 partial；健康检查只取一页。

定向在线验证（默认跳过）：

```sh
JOBHUNTER_ONLINE_SOURCES=1 JOBHUNTER_ONLINE_SOURCE=bilibili-social pnpm exec vitest run --project online apps/web/test/task-runtime/bilibili-social.online.test.ts
```

测试使用真实生产适配器和 Worker 浏览器客户端，最多三次列表请求（UI 首屏、配置容量首页、末页）及一条详情。已通过 2026-09-11 门禁，catalog 物理来源默认启用；社招逻辑渠道开关仍遵循既有默认规则，seed 不覆盖用户已有开关。

## 校招与实习

`bilibili.campus@1.0.0` 使用 `/campus/positions`，`bilibili.intern@1.0.0` 使用 `/campus/positions?type=0`。校园列表按性质 3/0 区分，请求 recruitType 可为官网初始化 null，校招响应必须满足 1/全职；实习总列表允许 recruitType=0 或 1，但职位性质必须为实习。实习覆盖空 practiceTypes 的总列表，不限定年份或项目 ID。详情深链均为 `/campus/positions/<id>`。

两渠道复用公司内正文/日期转换与分页保护，默认 50 条、间隔 5 秒，无浏览器即 access_blocked；错误业务码与未知类别显式失败。列表正文内联，不逐岗位请求详情。物理来源默认开启，已有用户开关不被 seed 覆盖。

```sh
JOBHUNTER_ONLINE_SOURCES=1 JOBHUNTER_ONLINE_SOURCE=bilibili-campus,bilibili-intern pnpm exec vitest run --project online apps/web/test/task-runtime/bilibili-campus.online.test.ts apps/web/test/task-runtime/bilibili-intern.online.test.ts --maxWorkers=1
```

2026-11-03 独立生产 smoke 通过：校招 88 条，仅两页且边界闭合为 complete；实习 308 条，首尾 58 条为 partial/sampled_pages。当时测试固定上限两页及一条详情，不随总数扩大而遍历全站，不写业务数据库。

实习在线 smoke 现采样首、中、末三页及一条详情，避免只查首尾遗漏中间页的招聘体系差异。2026-11-03 排查发现 308 条实习中有 9 条 recruitType=1、299 条为 0，均为官网实习性质；不依据标题判定实习。
