# 携程官网来源

对应规格 SWT-018。三个 required 物理来源独立映射逻辑渠道：

| 来源         | 官方分区                       | 招聘性质               |
| ------------ | ------------------------------ | ---------------------- |
| ctrip.social | experienced，category=1/kind=1 | 社会正式岗位，包含客服 |
| ctrip.intern | experienced，category=1/kind=3 | 日常实习               |
| ctrip.campus | campus，category=2/kind=1      | 应届校招               |

匿名 POST `https://careers.ctrip.com/api/hrrecruit/getJobAd`，无需浏览器或账号。唯一 Cookie 是固定的展示语言偏好 `language=zh-CN`；不读取用户 Cookie，不传登录态、追踪标识或签名。只有 head.language 不足以选中文，缺少语言 Cookie 会返回英文城市，影响地域识别。

成功码 `201`，固定每页 10。稳定 ID 为 `fromId`（MJ 编号），而非列表行 `id`。正文已内联，生产不逐岗请求详情；在线 smoke 用同一接口的 condition.fromId 独立读取一条详情并核对身份。Schema 严格校验 category/kind、正文和日期，白名单剔除内部 HR/用户信息。

`maximumPages` 默认 1000；生产顺序分页。显式 `pageSampling: first-last, maximumPages: 2` 只读首尾两页。总数漂移、短页、重复 ID 或采样均保持 partial，不能触发缺失下线。响应不回显页码，不将请求页号冒充响应证据。健康检查只请求首页，沿用 HTTP 来源限流 12/min、burst=1。

范围不含尚未开放的留用实习或其他独立品牌/国际站。缺少城市保留空数组，沿用应用未知地域规则，不根据标题补城市。没有改动既有数据库运行开关；新逻辑渠道沿用仅实习默认开启规则。

定向验证（默认跳过在线测试，不运行全量门禁）：

```sh
JOBHUNTER_ONLINE_SOURCES=1 JOBHUNTER_ONLINE_SOURCE=ctrip pnpm exec vitest run --project online packages/sources/test/ctrip.online.test.ts
```

也可将选择器设为 ctrip.social、ctrip.intern 或 ctrip.campus，分别复核。
