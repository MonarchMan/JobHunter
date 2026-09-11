# 第二批官网来源研究台账

> 验证日期：2026-09-11（Asia/Shanghai）
> 范围：五家公司入目录；已工程化 B 站社招、快手三渠道、滴滴国内来源、携程及米哈游三渠道。未运行全量门禁。

## 公司与渠道

| 公司     | 社招                             | 实习                               | 校招                               |
| -------- | -------------------------------- | ---------------------------------- | ---------------------------------- |
| 快手     | 生产适配器 smoke 通过，supported | 日常/校园实习均独立通过，supported | 当前应届项目独立通过，supported    |
| 哔哩哔哩 | 生产适配器 smoke 通过，supported | 待确认校园站记录级分类             | 官网提供校园导航，待独立验证       |
| 滴滴     | supported，保留已知官网短页保护  | supported                          | 常规校招 supported，未来精英待验证 |
| 携程     | 匿名 HTTP smoke 通过，supported  | 日常实习独立通过，supported        | 应届校招独立通过，supported        |
| 米哈游   | 全职/第三方编制，supported       | 校园实习专项，supported            | 应届校招，supported                |

以上 15 个逻辑渠道已纳入 catalog，其中 13 个已 supported；B 站校园两渠道尚无物理 adapter，派生 blocked。五家公司共新增 15 个物理来源（含滴滴未来精英 experimental）；全目录 20 公司/60 逻辑渠道/62 物理来源。逻辑渠道开关沿用既有默认规则（仅实习默认开），原 15 家公司的支持状态未改变。

## 米哈游工程化（2026-09-11）

官方新站：[社会岗位](https://jobs.mihoyo.com/#/position)、[校园岗位](https://jobs.mihoyo.com/#/campus/position)。`#/social/position` 不是正确路由，不能把该地址的 404/登录提示判断为匿名列表不可用。正常匿名 Chrome 页面独立确认列表和详情公开调用；生产直接 HTTP，不依赖浏览器、用户 info 接口、登录态、Cookie、追踪字段或签名。

统一公开 API 根地址为 `https://ats.openout.mihoyo.com/ats-portal`。列表 POST `/v1/job/list`，channelDetailIds=[1]、pageNo=1/pageSize=10；社会 hireType=0，校园 hireType=1。响应 code=0/success=true，data.list/total/pageNo/pageSize，列表白名单有 id/title/addressDetailList/competencyType/jobNatureId/jobNature/projectName/channelDetailIds，没有完整正文。未知业务码和 Schema 变化失败，认证 code=-3 为 access_blocked，不作为零结果。

校园当前未筛选总数 262，官方 ProjectEnum 返回“实习生专项”和“2027届秋招”；官网点击实习项目发送 projectIds=["4"]，返回 144。官网详情推荐列表也使用 jobNatures 字段。匿名调用证实 hireType=1/jobNatures=[3] 返回相同 144 条实习性质范围，jobNatures=[1] 返回 118 条全职应届范围。正式实现按职位性质拆分，不写死项目 4/13 或 2027 年，纳入对应性质全部公开项目；列表校验性质与渠道，详情再核验真实 hireType。社招入口实习筛选目前为合法零，无真实详情，不另建占位来源；实习 supported 只声明校园实习专项。

社招不添加 jobNatures 过滤。研究发现全职筛选仅 602 条，而未筛选总数 662；末页是 jobNatureId=5“第三方编制”，[6534 详情](https://jobs.mihoyo.com/#/position/6534)独立确认 hireType=0/status=1、真实职责与要求。全职与第三方编制都属于本官网社招，适配器均保留，employmentType 原样表达，不冒充米哈游直接雇佣；性质不符或未知仍失败，不能静默丢弃。未独立声明覆盖其他品牌或海外官网，当前官方列表本身的海外城市按原样交给应用地域规则。

详情 POST `/v1/job/info`，body={id,channelDetailIds:[1],hireType}；响应必须同一 id、分区、性质，开放 status=1，description/jobRequire 非空。使用 required 详情契约在事务之外读取再归一化，不使用 jobSummary 占位。没有发布日期则 publishedAt=null；未知地点不推测。正文为官网纯文本职责与要求；白名单剔除用户投递状态、内部代码和无关信息，fixture 为合成样本。

| 物理来源      | 官网总数 | 请求页 | 首尾条数 | 样本数 | 详情                                                   |
| ------------- | -------- | ------ | -------- | ------ | ------------------------------------------------------ |
| mihoyo.social | 662      | 1 / 67 | 10 / 2   | 12     | [3845](https://jobs.mihoyo.com/#/position/3845)        |
| mihoyo.intern | 144      | 1 / 15 | 10 / 4   | 14     | [9382](https://jobs.mihoyo.com/#/campus/position/9382) |
| mihoyo.campus | 118      | 1 / 12 | 10 / 8   | 18     | [9250](https://jobs.mihoyo.com/#/campus/position/9250) |

最终社招 smoke 为 16:18:18 CST，实习/应届为 16:15:38 / 16:15:49 CST；每项仅首页、末页和一条详情，生产 HTTP 限流 12/min、burst=1。同次两端总数、页码容量回显、边界与 ID 唯一性通过，全部 partial/sampled_pages；没有全量抓取或在线逐岗详情。之前社招 602 的全职采样已由包含第三方编制的 662 范围替代。公司稳定 ID 后缀 120，三个物理来源后缀 261/262/263，均 supported/default on，逻辑渠道仍仅实习默认开，不更改既有业务数据库开关。

回归通过：米哈游/携程/滴滴/目录单元 94/94，SQLite seed/sync 18/18，涵盖 required 详情失败不创建岗位、随后成功入库及 partial 不增加 missing_count。新接入未改变共享契约或架构依赖，无需新 ADR。

## 快手社招

- 官方入口：[社会招聘](https://zhaopin.kuaishou.cn/#/official/social/)。同一官网导航提供 [日常实习](https://zhaopin.kuaishou.cn/#/official/trainee/) 和 [校园招聘](https://campus.kuaishou.cn/recruit/campus/e/#/campus/index/)。三个渠道的后续生产验证见下文。
- 列表：`GET /recruit/e/api/v1/open/positions/simple`；官网请求参数 `pageNum=1&pageSize=10&positionNatureCode=C001&recruitProject=socialr`。
- 响应：`code=0`、`result.total`、`result.pageNum`、`result.pageSize`、`result.list`。稳定职位 ID 为数值 `id`；样本同时满足 `positionNatureCode=C001`、`recruitProjectCode=socialr`。
- 公开字段：`name`、`description`（职责）、`positionDemand`（要求）、`workLocationsCode`；地点、职位类别和工作经验需要配合官网字典映射。正式适配器应使用字段白名单，不能保存响应中未使用的招聘内部结构字段。
- 验证：total=1254，每页 10，首页 10 条、第 126 页 4 条，样本 14 个唯一 ID；两端总数一致、末页页码正确。
- 详情：`GET /recruit/e/api/v1/open/position?id=18328`，返回同一 ID、岗位名、职责与要求；[岗位级官网链接](https://zhaopin.kuaishou.cn/#/official/social/job-info/18328)正常显示“小语种审核-【西语】”。
- 访问方式：正常匿名 Chrome + Playwright 加载官网成功，无需登录。裸 HTTP 列表返回 HTTP 400 / code=1；捕获首屏模板后直接修改页码的会话内 fetch 返回 code=-1“系统错误”。这证明该重放方式未闭合，不能仅凭现象断言具体签名算法或风控原因。
- 官网正常点击末页时生成的请求成功。因此当前是“官网页面驱动协议可行”，不是“现有通用 JSON 重放器可直接复用”。后续优先评估官网原生请求入口在 SourcePageClient 内的实现；若必须采用 DOM 翻页，应先修订 OSE-010 的禁止 DOM 翻页约束，再实现生产驱动。研究 smoke 中的正常页面操作不作为该约束已变更的依据。

## 哔哩哔哩社招

- [旧入口](https://www.bilibili.com/blackboard/join-list.html)当前通过页面脚本跳转至 [新招聘站](https://jobs.bilibili.com/social/positions)，不能沿用旧地址作为规范化职位深链。
- 列表：`POST /api/srs/position/positionList`；官网请求 `pageNum=1`、`pageSize=10`、`recruitType=0`、`workTypeList=["3"]`、`positionTypeList=["3"]`，其余职位/地点等过滤为空，`onlyHotRecruit=0`。
- 响应：`code=0`、`data.total`、`data.list`；稳定 ID 为数值 `id`。样本均为 `recruitType=0`、`positionTypeName=全职`，正文来自 `positionDescription`，地点来自 `workLocation`。
- 验证：total=517，每页 10，首页 10 条、第 52 页 7 条，样本 17 个唯一 ID；两端总数一致。
- 分页异常：首页 `data.pages=52`，末页却返回 `data.pages=74`、`size=7`。观察值符合按实际页长计算页数的表现，但未验证后端实现。生产代码必须按请求的 pageSize 和 total 计算末页，不能用末页的 pages/size 覆盖分页计划。
- 详情：`GET /api/srs/position/detail/28968`，与列表 ID 和名称一致，正文包含工作职责和工作要求；[岗位级官网链接](https://jobs.bilibili.com/social/positions/28968)正常显示“直播用户产品”。详情含 HTML 标记，归一化时需要安全转为文本并明确日期时区。
- 访问方式：裸 HTTP 返回 `code=-101`、`ajSessionId不能为空`，不是职位空列表。官网创建匿名会话后，在同一浏览器上下文内保留必要请求头、修改 pageNum 的 JSON 重放成功。未使用账号或用户 Cookie，未保存匿名会话凭据。
- 工程建议：优先实现 B 站社招，扩展现有浏览器 JSON 重放的响应解析与页码参数映射；明确验证业务 code，处理上述分页字段异常。再补 Schema/fixture、归一化与 partial 测试，并通过适配器自身的定向 smoke 后晋级 supported。

## 后续三家公司

- 滴滴：[国内招聘入口](https://talent.didiglobal.com/)与[国际招聘入口](https://careers.didiglobal.com/)分别记录，不混并不同站点故障域。初次研究未验证，国内后续工程化结果见本文滴滴章节；国际站仍未接入。
- 携程：[旧校园入口](https://campus.ctrip.com/)已确认跳转统一官网校园导航，当前三渠道工程化见下文。集团不同品牌不能仅因归属关系就假定由一个入口覆盖。
- 米哈游：[旧站迁移说明](https://join.mihoyo.com/)指向[新招聘站](https://jobs.mihoyo.com/)。后续分别核实社招、校招与实习入口及 ATS 协议。

## 可重复验证

测试文件：`apps/worker/test/official-source-wave-two.online.test.ts`。默认跳过，显式选择公司后执行。每家公司仅请求首页、末页和一条详情；官网初始化所需的字典与会话请求不计作列表页，不会遍历其余职位。

```sh
JOBHUNTER_ONLINE_SOURCES=1 JOBHUNTER_ONLINE_SOURCE=kuaishou,bilibili pnpm exec vitest run --project online apps/worker/test/official-source-wave-two.online.test.ts
```

本次显式使用系统 Google Chrome（通过 `JOBHUNTER_BROWSER_EXECUTABLE` 指定），无持久化 profile。2026-09-11 11:50 CST，正式测试 2/2 通过，耗时 8.18 秒。输出只包含时间、总数、采样页、页长、样本数、详情 ID、`partial + sampled_pages`，不输出请求凭据。

上述研究结论仅覆盖两个社招协议的边界样本，不证明全量完整性、长期稳定性或另外四个招聘渠道。

## B 站生产适配器门禁

2026-09-11 12:03 CST，`apps/worker/test/bilibili-social.online.test.ts` 使用 `createBilibiliSocialAdapter` 和实际 `createPlaywrightSourcePageClient` 完成在线验证，1/1 通过，16.77 秒。生产配置每页 50 条、JSON 间隔 5 秒；官网初始化的 10 条首屏后重放配置容量首页和末页，再打开一条详情校验。样本全部完成生产归一化，检查招聘类型、稳定 ID、地点、纯文本职责要求与新站深链，采样状态为 partial / sampled_pages。

已注册 `bilibili.social@1.0.0`，来源 UUID `018f0000-0000-7000-8000-000000000249`，晋级 supported；source seed 默认启用，但不覆盖既有逻辑渠道开关。物理来源数从 47 增至 48，公司与逻辑渠道数仍为 20 / 60。

```sh
JOBHUNTER_ONLINE_SOURCES=1 JOBHUNTER_ONLINE_SOURCE=bilibili-social pnpm exec vitest run --project online apps/worker/test/bilibili-social.online.test.ts
```

## 快手三个渠道工程化复核

2026-09-11 12:50 CST，真实生产适配器 + Worker 匿名 Chrome 驱动独立验证 4/4 通过（51.86 秒）。每项每页 50 条、仅首页与末页，并另外访问一条官方详情，核对 ID、标题、trim 后职责和要求；全部样本通过归一化、地点、性质、唯一 ID、页码和边界校验。没有全量遍历。

| 物理来源               | 逻辑渠道 | 官网总数 | 采样页 | 页内条数 | 独立详情 ID |
| ---------------------- | -------- | -------: | ------ | -------- | ----------- |
| kuaishou.social        | 社招     |     1254 | 1、26  | 50、4    | 32022       |
| kuaishou.intern        | 实习     |     1113 | 1、23  | 50、13   | 32237       |
| kuaishou.intern.campus | 实习     |      225 | 1、5   | 50、25   | 11301       |
| kuaishou.campus        | 校招     |      266 | 1、6   | 50、16   | 13101       |

以上均为 `partial / sampled_pages`，总数是官网报告值而非实际全量采集量；日常与校园实习不得相加宣称去重总量。新增来源 UUID 后缀依次为 250、251、252、253，四者均 required。目录总计 20 家公司、60 个逻辑渠道、52 个物理来源。

12:57 CST 在完成目录注册后再次用各自真实 source UUID 复核，4/4 通过（52.05 秒），上述总数、页码、末页长度与详情 ID 均一致。定向离线测试 136/136、SQLite seed/sync 8/8 通过。

### 独立协议

- 社招：主站原始 `positionSimpleUsingGET({pageNum,pageSize,positionNatureCode:'C001',recruitProject:'socialr'})`，对应既有社招 endpoint。
- 日常实习：同方法但 `positionNatureCode:'C002'`，不附加 recruitProject 或地点过滤。官网初始 domestic 筛选报告 1112，未限制地点是 1113，因此生产不得沿用 domestic 参数。详情深链 `/official/trainee/job-info/:id`，详情 API 与社招相同，但验证独立。
- 两个校园来源：校园原始 `indexUsingPOST({recruitSubProjectCodes:[code],pageNum,pageSize})`，对应 `POST /recruit/campus/e/api/v1/open/positions/simple`。从 `v1OpenSubProjectListUsingGet({pageNum:1,pageSize:100})` 获取当前完整 12 个项目，再分别选择最新年份 fulltime / intern；不能依赖所有历史项目也为 true 的 active 字段。
- 当前应届项目 `20271779425607`，校园留用实习项目 `20271772783534`，均为 2027。应届默认列表包含快 Star 岗位，不加人才计划筛选。项目码只作本次证据，不写死在生产配置。
- 校园详情 `GET /recruit/campus/e/api/v1/open/positions/find?id=:id`；规范深链 `https://campus.kuaishou.cn/recruit/campus/e/#/campus/job-info/:id`。
- 主站地点、工作经验与职位类别从 `getDictMapUsingGET` 解码；校园地点直接来自 `workLocationDicts[].name`。不保存列表内无关招聘内部字段。

### 运行时与失败复核

固定模块路径 `./src/services/api/DefaultApi.ts`：主站导出 DefaultApi 构造器，校园站导出 a 实例对象；不自动扫描候选模块或试探未知 API。模块来自正常加载的官网脚本，并保持原始匿名请求封装。初始化直接打开无职位列表首页，不额外触发首屏列表。

首轮失败来自错误地只检查 chunk 队列（入口模块实际只保存在运行时注册表）；随后校园失败来自误将 a 实例当构造器；日常实习详情比较差异仅为尾部空格。分别修正固定模块注册判断、精确导出形态和比较前 trim 后，以上四项全部通过。失败不属于已确认风控阻断，没有通过签名复制、指纹修改或登录态复用解决。

```sh
JOBHUNTER_ONLINE_SOURCES=1 JOBHUNTER_ONLINE_SOURCE=kuaishou pnpm exec vitest run --project online apps/worker/test/kuaishou.online.test.ts --reporter=verbose
# 也可只选一个物理来源，例如 JOBHUNTER_ONLINE_SOURCE=kuaishou.intern.campus
```

需要时通过 `JOBHUNTER_BROWSER_EXECUTABLE` 指定本机正常 Chrome；不需要 CDP 常驻进程、小号或人工登录。

## 滴滴国内四个物理来源工程化（2026-09-11）

官网导航分别指向 [社招](https://talent.didiglobal.com/social/list/1)、[实习 Moka 6222](https://app.mokahr.com/apply/didiglobal/6222#/jobs)、[常规校招 Moka 96064](https://campus.didiglobal.com/campus_apply/didiglobal/96064#/jobs)。校园导航的 [未来精英](https://outreach.didichuxing.com/elite/2024/) 立即投递指向 [独立 Moka 116021](https://app.mokahr.com/campus-recruitment/didiglobal/116021#/jobs)，不能被常规校招覆盖成功所替代。海外站不在本次接入范围。

14:15 CST 使用已注册 source UUID 的生产适配器、实际 Worker 浏览器客户端与匿名 HTTP 完成复核：

| 物理来源          | 官网总数 | 页码 / 原始页长 | 在招样本 | 详情核对                             | 结论                                   |
| ----------------- | -------: | --------------- | -------: | ------------------------------------ | -------------------------------------- |
| didi.social       |     1036 | 1、65 / 16、1   |       17 | 65637 / JR20260806007                | experimental，末页应有 12 条但仅返回 1 |
| didi.intern       |      605 | 1、21 / 30、5   |       34 | 97be8af8-1cec-4438-9197-69aff6aa72cd | supported，原始 35 条中 1 条 pause     |
| didi.campus       |      151 | 1、6 / 30、1    |       31 | e9b38ef8-3a9a-4932-89a8-47513ae7f0a5 | supported                              |
| didi.campus.elite |        0 | 1 / 0           |        0 | 无真实岗位可验证                     | experimental，合法空结果，不是详情通过 |

在线测试 4/4 表示两项支持门禁、社招安全降级和未来精英合法零结果验证均符合预期，**不是四项 supported 门禁通过**。非空集合均 partial；社招 reason=invalid_page_boundary，其他非空集合 reason=sampled_pages。总数是官网声明，不能当作已采集或已入库总量。社招额外抽查第 64 页仍返回 16 条且总数不变；未遍历其他页，原因未确证，不擅自修正总数或放松边界检查。

### 已确认协议与限制

- 社招匿名 GET `/recruit-portal-service/api/job/front/list?page=:page&recruitType=1&size=16` 返回 meta.code=0、data.total/items。容量 50 返回 10039；仅固定 16 已验证，不需要账号、登录 Cookie 或签名。详情 `/recruit-portal-service/api/job/front/view/:jdId` 校验 recruitType=1、jdStatus=2，以 jdNo 绑定列表 jdId；recordId 不是岗位稳定 ID。刷新时间不当作发布日期。
- Moka 原始网络响应是封装字符串，官网 webpack5 模块 `0wyxq0` 的 default(path).post(body) 返回解封后的公开职位对象。本实现调用原客户端，不复制响应解密实现或改浏览器指纹。列表固定 `/api/outer/ats-apply/website/jobs/v2`，orgId=didiglobal，siteId 使用对应字符串、limit=30、offset、needStat=true、空 customFields/jobIdTopList，site 为 social（实习）或 campus。详情 `/api/outer/ats-apply/website/job` 使用同 orgId、数字 siteId、目标 UUID 和 zh-CN。
- 校园列表包含 HTML 正文，可 inline 归一化；实习列表无正文，详情正文可取。社招/实习必须使用 required 详情模式后才能入库（ADR-0024），不能误用 deferred 补充模式绕过正文要求。实习首条官网地点数组为空，保持真实空值，应用仍按既有未知地区策略跳过；不宣称 smoke 样本全部能入库。
- pause 样本为 `13625055-fd0c-477b-bd83-d8f8850016b4`，公开列表确实返回该状态；参与分页闭合但不输出为在招。未知状态、跨公司/渠道、详情 ID 错配、缺正文或日期异常均失败。
- 四来源分别拥有 UUID 后缀 254–257，全部 required。实习与常规校招物理来源默认启用；社招与未来精英默认关闭。逻辑渠道状态：实习 supported、校招 experimental、社招 experimental。既有逻辑开关不覆盖，当前总目录 20/60/56。
- Worker 初始化匿名首页后只调用固定公开列表/详情操作，串行请求间隔至少 5 秒，单请求 30 秒、单次列表采集 300 秒截止，所有出口释放页面与外层 context/browser。health 只取首页；无浏览器时 Moka 报 access_blocked。原始内部配置与会话字段不保存到 fixture 或数据库。

```sh
JOBHUNTER_ONLINE_SOURCES=1 JOBHUNTER_ONLINE_SOURCE=didi pnpm exec vitest run --project online apps/worker/test/didi.online.test.ts --silent=false --reporter=verbose
# 可单选 didi.intern / didi.campus / didi.social / didi.campus.elite；只采首尾和一条详情，不执行全量同步。
```

社招晋级条件：官方页长与总数重新闭合，且首页/末页/详情重新通过；未来精英晋级条件：出现真实职位后补独立边界及详情验证。合法零结果不填造 fixture 作为线上证据，异常也不标为已经解决。

14:25 CST 在 required 入库模式与首次调用冷却完成后再次复核，4/4 安全/支持检查通过（55.47 秒）：实习官网新增岗位，总数为 606，页 1/21 长度 30/6，在招样本 35、暂停 1，详情 `4e25f4e3-595c-470b-8417-48199120ff4a`；同次首尾总数一致。常规校招仍 151、社招仍 1036 且末页异常、未来精英仍 0。没有把两轮之间的正常新增误判为单轮总数漂移，也没有改变未通过来源的默认关闭状态。

### 后续范围调整与社招复核（2026-09-11）

**最新验收决定（替代下文未晋级结论）**：用户随后亲自打开第 65 页确认官网同样异常，并明确要求社招记为 supported。现按 SWT-017 的来源级验收例外登记 supported；目录默认启用，但已有开关不重置。此决定不是上游修复或完整性验证通过：异常运行仍 partial/invalid_page_boundary，禁止执行缺失下线；未来精英仍是待验证的校园 supplemental 来源。历史观测与失败证据保留如下。

用户明确将未来精英归校招、延期验证。它仍保留 `didi.campus.elite` 的来源身份与 experimental/default off，但覆盖角色调整为 supplemental。当前校招支持范围以常规校招为准，逻辑状态为 supported；这不是宣称未来精英的详情已验证。旧 seed 重新运行时只更新该覆盖角色，不重置已有开关或更换 UUID。

社招排查结果：

1. 普通匿名 Chrome 打开 PC 官网首页并直接点击官网第 65 页，原生请求 `page=65&recruitType=1&size=16` 返回 `total=1036,page=65,size=16,items.length=1`；异常不是本适配器独有。
2. 匿名 HTTP 的 no-cache/no-store、额外刷新查询参数使部分响应总数更新至 1039，但第 65 页仍只有 ID=65714 一条；按 1039 应有 15 条。不能据此把总数改成 1025，缓存是否为根因也尚无证据。
3. 试验容量 8/10 时服务器仍回显 size=16；移动官网原生脚本虽固定请求 size=10，其真实响应也回显 16。移动端使用同一个 front/list 接口，未发现独立可靠数据源。不能按请求容量 10 去请求第 104 页并将空页当作完成。
4. 公开前端代码确认 PC 分页使用 data.total、固定 16，直接展示 data.items；不存在可据以解释缺失数量的客户端过滤。现有证据无法判断后台计数、列表缓存或其他上游规则的具体原因，不能臆断为暂停岗位过滤。
5. 已修复适配器未校验响应分页字段的问题：社招强制核验响应 page 与实际请求相等、size=16，错误回显与字段缺失显式失败；原有末页/唯一 ID/总数检查不放松。在线安全测试还断言边界异常来源不得 supported/default on，防止绿色测试误导致晋级。

结论：校招范围调整完成；社招可获取公开列表及详情，但完整性接入问题仍受上游异常阻塞，SWT-T011 保留未完成，不能宣称已修复或晋级 supported。后续需要官网恢复自洽分页或发现有独立完整性证据的官方替代接口；本轮没有全量遍历。

## 携程三渠道工程化（2026-09-11 15:55 CST）

官方入口已独立核实：[社会招聘](https://careers.ctrip.com/#/experienced/jobList?kind=1)、[日常实习](https://careers.ctrip.com/#/experienced/jobList?kind=3)、[应届校招](https://careers.ctrip.com/#/campus/jobList?kind=1)。旧 campus.ctrip.com 跳转统一官网校园页；客服导航只是社招 jobFamilyGroupCode 筛选，不另建来源。校园页显示应届校招生 2027，留用实习“暂未开启，敬请期待”；当前只为三个开放分区注册 required 来源，不以社招实习替代留用实习验证。不隐含覆盖 Global Recruitment 或其他独立品牌站。

### 匿名协议与语言

官网公开模块调用 `POST /api/hrrecruit/getJobAd`。列表 condition 包含空 fromId、keyword、country、city、bucode、jobFamilyCode、jobFamilyGroupCode；唯一分区限制为社招 category=1/kind=["1"]、实习 category=1/kind=["3"]、校招 category=2/kind=["1"]。不设置职位类别/地点过滤，保留 Eagle 等当前校园岗位。pager.index/size 为字符串，容量 10；成功 retCode="201"，retValue.total/recruitJobAdList 为真实计数和记录。响应没有页码回显，因此只用可验证的总数、边界和唯一 ID 检查，不能宣称已校验上游页码回显。

最初只传 head.language=zh_CN 时，匿名 HTTP 已成功返回所有分区，但 cityName 为 Shanghai 等英文。正常匿名官网实际设置的展示 Cookie 是 language=zh-CN；HTTP 仅附带该固定偏好即返回“上海”等中文，已通过生产 HTTP 客户端复核。无需账号、小号、登录/追踪 Cookie、签名或常驻浏览器；未逆向 c-sign。普通 Chrome 仅用于研究官方入口和真实公开请求。

稳定身份为 fromId（MJ 编号），不是每次列表行 id；岗位级 URL 为 experienced/campus 下的 job-detail/MJ 编号。详情使用同一 endpoint，condition={fromId:[目标编号]}，pager={index:"1",size:"10"}，响应必须 total=1、仅一条并与目标 fromId 一致。列表已经内联 requirements/duty，因此生产 detail=inline，不逐条详情抓取；两端正文均通过相同严格解析器。发布日期来自 publishDate，按 Asia/Shanghai 解释。城市 null 保留空数组，不从标题猜测伦敦等地点。内部 user/HR 字段不进入白名单或 fixture；提交 fixture 为合成正文与合成 ID。

### 最终生产适配器 smoke

| 物理来源     | 官网 total | 请求页 | 实际首尾条数 | 样本唯一数 | 独立详情                                                                |
| ------------ | ---------- | ------ | ------------ | ---------- | ----------------------------------------------------------------------- |
| ctrip.social | 487        | 1 / 49 | 10 / 7       | 17         | [MJ037012](https://careers.ctrip.com/#/experienced/job-detail/MJ037012) |
| ctrip.intern | 25         | 1 / 3  | 10 / 5       | 15         | [MJ036280](https://careers.ctrip.com/#/experienced/job-detail/MJ036280) |
| ctrip.campus | 57         | 1 / 6  | 10 / 7       | 17         | [MJ037031](https://careers.ctrip.com/#/campus/job-detail/MJ037031)      |

每项仅两次列表请求和一次详情请求，生产 TokenBucket 限流 12/min、burst=1。同次两端总数稳定、页长自洽、样本 ID 不重复，采样全记录归一化通过，三项都明确 partial/sampled_pages，total 不是实际全量入库数。校招初次工程化测试因错误要求首职位必须在上海而失败，真实首职位为南通；修正测试为核对响应地点及中文语言偏好后，15:55:13 / 15:55:23 / 15:55:33 CST 最终三项独立通过，没有放宽分页或身份校验。

三条来源 supported/default on，逻辑渠道沿用仅实习默认开；稳定公司 ID 后缀 119，来源 ID 后缀 258/259/260。未操作已有业务数据库开关。离线异常测试覆盖错误业务 envelope、招聘分区错配、缺少正文、非法日期/ID、重复/短页/总数变化、有限采样、取消及健康检查。SQLite 独立验证三个来源入库及 partial 不增加既有岗位 missing_count。留用实习开放后仍需独立验证再决定新增物理来源。
