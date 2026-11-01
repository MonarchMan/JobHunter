# 米哈游官网来源

对应 SWT-019，使用匿名 HTTP，无需浏览器、账号、Cookie 或签名。

| 来源          | 分区                      | 覆盖                               |
| ------------- | ------------------------- | ---------------------------------- |
| mihoyo.social | hireType=0，不过滤性质    | 全职与第三方编制，保留原始用工性质 |
| mihoyo.intern | hireType=1/jobNatures=[3] | 校园实习专项                       |
| mihoyo.campus | hireType=1/jobNatures=[1] | 应届校园岗位，不固定项目或年份     |

列表 POST `https://ats.openout.mihoyo.com/ats-portal/v1/job/list`，channelDetailIds=[1]，pageNo/pageSize=10。严格检查业务成功、页码与容量回显、招聘性质与官方渠道。列表不包含完整职责要求，jobSummary 不能作替代正文；详情 POST `/v1/job/info`，验证 id、hireType、性质和 status=1 后，才能通过 required 详情契约入库。

岗位深链为 `https://jobs.mihoyo.com/#/position/:id` 或 `#/campus/position/:id`。城市来自 addressDetailList；未提供发布日期则 null。字段白名单不保存用户投递状态、内部代码或认证数据。

生产顺序串行分页，12 请求/分钟、burst=1；maximumPages 默认 1000。显式 first-last/maximumPages=2 用于 smoke。采样、短页、重复 ID、总数漂移均 partial，不触发缺失下线；健康检查仅首页。required 详情失败不写占位岗位。

当前社招入口实习筛选为合法零，实习支持范围明确为校园实习专项；其他独立品牌/海外入口不隐含覆盖。社招列表本身的海外地点保留原始字段，由应用地域规则处理。三个来源默认启用，逻辑渠道沿用仅实习默认开；不重置已有数据库运行开关。

```sh
JOBHUNTER_ONLINE_SOURCES=1 JOBHUNTER_ONLINE_SOURCE=mihoyo pnpm exec vitest run --project online packages/sources/test/mihoyo.online.test.ts
```

可用 mihoyo.social、mihoyo.intern、mihoyo.campus 单独选择。每项只请求首页、末页与一条真实详情，禁止用本次 smoke 声称已全量采集。
