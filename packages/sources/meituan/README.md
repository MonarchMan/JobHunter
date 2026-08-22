# 美团官网来源

- 复核日期：`2026-08-21`
- 入口：<https://zhaopin.meituan.com/web/social>
- 状态：`supported`，默认启用
- 证据：匿名 `POST /api/official/job/getJobList` 返回社招列表与 `totalCount/totalPage`；匿名 `POST /api/official/job/getJobDetail` 返回同一 `jobUnionId` 的详情。请求体和字段来自官网公开前端 source map，未携带 Cookie。
- ID：`jobUnionId`，已在列表/详情固定样本中保持一致。
- URL：详情使用 `/web/position/detail?jobUnionId=...&jobShareType=1`，投递入口使用 `/web/delivery-confirm?...`，均规范化到 `zhaopin.meituan.com` HTTPS。
- 样本：`test/fixtures/meituan/`，脱敏 JSON；列表、详情媒体类型均为 `application/json`。
- 门禁：`smoke-20260821-meituan-01` 已完成匿名 24 页/2349 条全量分页、稳定 ID、详情规范化和在线 Smoke；默认低频串行，403/429/验证页按公共错误分类停止。
- 样本 SHA-256：`list-page-1.json` `32f6dcaa7a6422ad95cfb7e9d61c875c0b57bf9527c86eeb1790b64b0ad92b75`；`list-page-2.json` `3d2601279d9175f849b932d75bb6b739d06b978cb0a2f78c0f33e3c26ef8b224`；`detail.json` `459397cf192ad96172afcdb799deba224f6476aa1dae020768c6c00d4f88ef75`。
