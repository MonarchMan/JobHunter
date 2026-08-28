# 360 官网来源

## `qihoo360.social`

- 入口：`https://hr.360.cn/hr/list`
- 传输：匿名浏览器读取官网自身请求的 `/v2/index/getlistsearch` JSON
- 范围：官网当前公开职位列表
- 详情：当前列表字段不足以还原完整职责，先保留为 `experimental`
- 限制：裸 HTTP 当前返回 500；不伪造风控参数、不复用登录 Cookie，详情与全量在线门禁闭合前不默认启用
