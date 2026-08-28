# 腾讯官网来源

- 复核日期：`2026-08-20`
- 入口：<https://careers.tencent.com/search.html>
- 状态：`supported`，默认启用
- 策略：公开匿名 JSON，列表 `Query`、详情 `ByPostId`；不携带 Cookie
- ID：`PostId`，在重复列表与详情请求中一致
- 完整性：逐页读取至发现数等于 `Count`；总数变动、重复 ID 或提前空页均降级为 `partial`
- URL：详情与投递均规范化到 `careers.tencent.com` HTTPS
- 限制：低频串行，默认 12 次/分钟、burst 1；403/429/验证页按公共错误分类停止
- 样本：`test/fixtures/tencent/`，已脱敏，不含认证数据，媒体类型均为 `application/json`
  - `list-page-1.json`: `34ca1422f91911f5a3c7498cd1cdcf307dbfe0479e64b547fec1279c82caee2c`
  - `list-page-2.json`: `93e322ad733f42fc2f8e204f696f553a6d245e62890cef6fb75e6de64906d13e`
  - `detail.json`: `caf437a1fb4c72a20dae6922705b3a8a6329ecc203802881eb85217a7dc9372e`
