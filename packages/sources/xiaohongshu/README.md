# 小红书官网来源

- 复核日期：`2026-08-22`
- 入口：<https://job.xiaohongshu.com/campus/position>
- 状态：`supported`，默认启用；适配器：`xiaohongshu.campus@1.0.0`
- 证据：匿名 POST `/websiterecruit/position/pageQueryPosition` 返回 `total=387`，每页 100 条时 4 页完整分页；`positionId` 稳定，`positionName`、`workplace`、`duty`、`qualification` 可完成归一化。
- 边界：适配器不依赖 Cookie 或动态 `x-s` 签名；若官网后续重新启用验证或响应 Schema 改变，会返回 `access_blocked`/`parse_changed`，不会伪造签名。
- 结论：通过在线 Smoke 和离线契约测试，默认低频串行启用。
- 固定样本：`test/fixtures/xiaohongshu/page-1.json`，SHA-256 `3e0beabdc4a0b9c0999067a3ac58f7b0aa6282584e436969583aec1d11687a3a`，已脱敏且不含会话令牌；覆盖单页分页边界与内联职位详情归一化。
