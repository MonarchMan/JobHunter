# 华为官网来源

- 复核日期：`2026-08-22`
- 入口：<https://career.huawei.com/cn/campus-recruitment-job-list?recruitmentType=INTERN>
- 状态：`supported`，默认启用；canonical 适配器：`huawei.intern@1.0.0`（底层校园协议适配器保留为内部实现）
- 采集方式：匿名浏览器执行官网自身脚本，读取同会话网关公开响应；不复制 Cookie、CSRF 或运行时参数。
- 列表协议：`POST /api/apig/channelhw/recruitmentPosition/pub/getJobPage`，请求体使用 `curPage/pageSize/jobType/recruitmentType`；响应使用 `data.result`、`data.pageVO.totalRows`、`data.pageVO.totalPages` 和 `data.pageVO.curPage`。
- 门禁证据：`smoke-20260822-huawei-01` 采集实习职位 31 条、4 页，coverage `complete`，31 个稳定 `jobId` 无重复；职位标题、职责/要求、地点和更新时间已归一化。
- 契约样本：`test/fixtures/huawei/collection.json`，SHA-256 `de054381d149d7f2bc4fb89c18d5b909dc7a530b3c3a2fb8994c8b0b30f2e534`；逐来源 Zod 记录 Schema 和公共来源契约测试已启用。
- 边界：页面出现登录、验证码或访问验证时返回 `access_blocked`；官网列表协议变化时返回 `parse_changed`，不猜测或伪造运行时参数。
