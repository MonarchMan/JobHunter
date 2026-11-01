# 百度校招官网来源

- 复核日期：`2026-08-22`
- 入口：<https://talent.baidu.com/jobs/list?recruitType=INTERN>
- 状态：`supported`，默认启用
- 协议：匿名 `POST /httservice/getPostListNew`，请求为 `application/x-www-form-urlencoded;charset=utf-8`；按 `recruitType/curPage/pageSize` 分页，单页最大 20 条。
- 范围：优先采集 `INTERN`，随后采集 `GRADUATE`；列表已内联职责与任职要求，稳定 ID 为 `postId`，详情 URL 为 `/jobs/detail/{recruitType}/{postId}`。
- 证据：`smoke-20260822-baidu-01` 完成 31 页，取得实习 458 条、应届 159 条，共 617 条且 ID 唯一，coverage `complete`。
- 边界：浏览器页面在打开开发者工具后跳转空白不影响采集；适配器不依赖 DOM、登录 Cookie、浏览器指纹或验证码规避。
