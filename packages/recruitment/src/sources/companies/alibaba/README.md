# 阿里巴巴官网来源

- 复核日期：`2026-08-22`
- 入口：<https://campus-talent.alibaba.com/campus/position?batchId=100000560002>
- 状态：`supported`，默认启用；适配器：`alibaba.campus@1.0.0`
- 采集方式：匿名浏览器执行官网自身脚本，读取同会话 `POST /position/search` 的公开响应；不复制 Cookie、CSRF 或运行时参数。
- 列表协议：请求体使用 `batchId/pageIndex/pageSize/customDeptCode/channel/language`；响应使用 `content.datas`、`content.totalCount`、`content.pageSize` 和 `content.currentPage`。
- 门禁证据：`smoke-20260822-alibaba-01` 采集 339 条、34 页，coverage `complete`，339 个稳定 `id` 无重复；职位标题、描述、地点和发布时间已归一化。
- 契约样本：`test/fixtures/alibaba/collection.json`，SHA-256 `a890971bb8415fcf0920d95e4721fca5d1aeeebf17999b5176aeaee627964203`；逐来源 Zod 记录 Schema 和公共来源契约测试已启用。
- 边界：页面出现登录、验证码或访问验证时返回 `access_blocked`；官网列表协议变化时返回 `parse_changed`，不猜测或伪造运行时参数。
