# 首批企业官网调研记录

> 调研日期：2026-08-19；Wave A 复核：2026-08-20；Wave B–F 复核：2026-08-21
> 性质：公开页面只读勘察，不是稳定接口承诺
> 复核要求：实现每个适配器时重新验证并保存脱敏固定样本

## 1. 调研方法与结论等级

本轮只验证官方入口、公开可见职位能力和粗粒度前端特征；未登录、未提交表单、未绕过验证码，也未将页面私有接口视为可长期依赖的公开 API。后续允许受控浏览器正常执行官网公开脚本并读取匿名渲染结果，但不逆向伪造风控参数或隐匿自动化身份。

结论等级：

- **A**：浏览器中可见公开职位或职位链接，可作为优先参考适配器。
- **B**：官方入口和公开搜索界面可见，但列表/详情或限制仍需实现 Spike。
- **C**：只确认官方入口，当前环境被阻断或未取得职位内容；必须先完成 Spike 才能承诺支持。

## 2. 来源矩阵

| 公司     | 官方入口（2026-08-19）                                                            | 观察                                                                                                                                                                                                            | 等级 | 实现前重点                                                            |
| -------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --------------------------------------------------------------------- |
| 腾讯     | <https://careers.tencent.com/search.html>                                         | 公开列表返回 `Count`/`Posts`，`PostId` 在列表和详情一致；详情补齐职责与要求；2026-08-20 实测 2275 职位                                                                                                          | A    | 已通过固定样本、契约与同步集成门禁；保持低频受控在线 Smoke            |
| 阿里巴巴 | <https://campus-talent.alibaba.com/campus/position?batchId=100000560002>          | `smoke-20260822-alibaba-01`：匿名校园实习页返回 339 条职位，34 页完整分页，稳定 ID 唯一                                                                                                                         | A    | 低频使用官网浏览器会话，协议变化时重新复核                            |
| 百度     | <https://talent.baidu.com/jobs/list?recruitType=INTERN>                           | `smoke-20260822-baidu-01`：匿名校招 JSON 接口采集实习 458、应届 159，共 617 条/31 页，稳定 ID 唯一                                                                                                              | A    | 保持 form-urlencoded 协议低频访问；页面空白不影响响应驱动采集         |
| 字节跳动 | <https://jobs.bytedance.com/experienced/position>                                 | `smoke-20260821-bytedance-01`：历史匿名 HTTP 200 页面约 903 KB 且公开脚本含 CAPTCHA/verify 资源；后续匿名 GET 返回 404，未取得当前职位集合                                                                      | B    | 重新确认官方入口；出现验证立即返回 access_blocked                     |
| 拼多多   | <https://careers.pddglobalhr.com/campus/intern>                                   | `smoke-20260822-pinduoduo-01`：匿名实习接口返回 2 条职位，1 页完整分页，稳定 ID 唯一                                                                                                                            | A    | 实习接口低频访问；社招风控接口不接入                                  |
| 美团     | <https://zhaopin.meituan.com/web/social>                                          | 匿名 `POST /api/official/job/getJobList` 返回社招列表（本次 `totalCount=2349`、`totalPage=235`），`POST /api/official/job/getJobDetail` 可按 `jobUnionId` 取得详情；公开 source map 给出请求结构，未携带 Cookie | A    | 保持低频受控在线 Smoke，并在官网变更时重新验证 Schema                 |
| 得物     | <https://careers.dewu.com/index/>                                                 | 历史复核中官方社会招聘页可匿名浏览，显示职位列表和独立校园招聘入口；列表请求由官网前端生成签名，当前入口已返回 404，浏览器分页门禁尚未完成                                                                      | B    | 重新确认官方入口后再验证全量分页、稳定 ID、详情和资源回收；不伪造签名 |
| 小红书   | <https://job.xiaohongshu.com/social/position>                                     | `smoke-20260821-xiaohongshu-01`：当前匿名 GET 为 200/约 4 KB“小红书”应用壳，未取得可复现列表 Schema；历史 JS 暴露列表/详情路径并含 CAPTCHA 路径                                                                 | B    | 保持 experimental；不猜测请求体，验证码出现即降级并记录               |
| 京东     | <https://campus.jd.com/home>                                                      | `smoke-20260822-jd-01`：匿名校园接口返回 75 条职位，1 页完整分页，稳定 `publishId` 唯一                                                                                                                         | A    | 校园接口低频访问；社会招聘接口另行复核                                |
| 华为     | <https://career.huawei.com/cn/campus-recruitment-job-list?recruitmentType=INTERN> | `smoke-20260822-huawei-01`：匿名校园实习页返回 31 条职位，4 页完整分页，稳定 ID 唯一                                                                                                                            | A    | 低频使用官网浏览器会话，协议变化时重新复核                            |

## 3. 分批策略

1. **参考适配器**：腾讯已完成；拼多多实习和京东校园接口已按各自官网脚本完成 JSON 适配。
2. **第二批**：字节、小红书。美团已于 Wave B 通过 JSON 适配器门禁；其他来源仍先完成半天到一天的 time-boxed Spike，再决定 HTTP、HTML 或 Playwright 实现。
3. **阻断风险批次**：阿里、百度、得物、华为。四个来源均已通过当前校园入口的适配器门禁。

“首批目标”表示产品希望覆盖，不等于在缺少公开访问证据时宣称已支持。每个来源的开发门禁在同目录 `spec.md` 中定义。

百度原范围例外已关闭，记录见[独立记录](./scope-exceptions.md)。

## Wave B：美团 Spike（2026-08-21）

- 官方入口 HTTP 200，页面标题为“美团招聘”；受控浏览器在本环境加载超时，未以此绕过或猜测接口。
- 官网公开前端 source map 明确使用 `POST /api/official/job/getJobList` 和 `POST /api/official/job/getJobDetail`。社招筛选使用 `jobType: [{ code: "3", subCode: [] }]`，分页字段为 `page.pageNo/page.pageSize/totalPage/totalCount`。
- 普通匿名 HTTP 请求成功返回 `status=1`；本次观察到 `totalCount=2349`、`totalPage=235`，详情 `jobUnionId=4702437501` 与列表一致。
- 适配器、运行时 Schema、脱敏列表/详情固定样本和离线契约测试已加入 `packages/sources`；样本 SHA-256 如下（媒体类型均为 `application/json`）：
  - `list-page-1.json`: `32f6dcaa7a6422ad95cfb7e9d61c875c0b57bf9527c86eeb1790b64b0ad92b75`
  - `list-page-2.json`: `3d2601279d9175f849b932d75bb6b739d06b978cb0a2f78c0f33e3c26ef8b224`
  - `detail.json`: `459397cf192ad96172afcdb799deba224f6476aa1dae020768c6c00d4f88ef75`
- `smoke-20260821-meituan-01` 已使用 `pageSize=100` 完成 24 页、2349 条匿名列表同步，ID 无重复；首条详情成功规范化。结合离线契约的重复发现、Schema、URL、partial 和 access-blocked 测试，美团于本次复核晋级 `supported` 并启用默认 Registry。
- 2026-08-21 显式在线回归 `JOBHUNTER_ONLINE_SOURCES=1 pnpm test:online` 中，腾讯、美团和京东 3 个来源 Smoke 均通过；京东仍按重复 ID 证据报告 `partial`，不改变支持状态。

## Wave A 复盘（2026-08-21）

- 腾讯的 JSON 协议使用 `Query/ByPostId` 与 `PostId`，美团使用 `getJobList/getJobDetail` 与 `jobUnionId`；字段、分页载荷、详情路由和响应结构均不同，当前没有足够证据证明共享 ATS 或公共解析层。
- 拼多多公开页面的列表请求依赖官网脚本生成的 `anti_content`，项目不伪造或绕过该风控值；它不能作为可复用协议实现。
- 结论：不提取公司外的 ATS 复用层，保持公司目录隔离；公共部分继续只复用 `@jobhunter/source-core` 的 HTTP、URL、错误分类和契约测试。`packages/sources/test/tencent.test.ts` 与 `packages/sources/test/meituan.test.ts` 两套契约测试均已重跑通过。

### 同日入口补充复核（2026-08-21）

- 拼多多入口当前仍返回 HTTP 200、标题为“拼多多集团-PDD社会招聘”；公开 Next.js 页面脚本调用 `POST api/recruit/position/list`，并通过 `isVerification`/`captchaCallback` 进入验证码或风控流程。该证据没有提供可无风控复现的职位列表，因此不改变 `experimental` 状态。
- 受控浏览器补充复核在 30 秒内未取得可读 DOM，页面加载导致浏览器连接重置；未点击验证码、未输入数据或注入风控参数，不能据此形成浏览器分页门禁。
- 字节跳动入口返回 HTTP 404；小红书入口返回约 4 KB 的应用壳；得物社招入口返回 HTTP 404；京东入口返回标题为“社会招聘”的页面。以上快照未形成新的稳定列表/详情门禁证据，也不改变现有支持状态。

## Wave C：京东 Spike（2026-08-21）

- 官方入口 HTTP 200，标题为“社会招聘”；官网公开脚本使用 `POST /web/job/job_count` 和 `POST /web/job/job_list`，未登录即可取得职位列表。
- 列表请求为 `application/x-www-form-urlencoded`，关键字段为 `pageIndex`、`pageSize`、`workCityJson`、`jobTypeJson`、`jobSearch` 和 `depTypeJson`；返回体是 JSON 文本数组。当前计数为 `1751`，服务端将 `pageSize` 固定为 `100`，应有 18 页。
- `requirementId` 在重复请求中可作为职位 ID；职责和要求直接内联在 `workContent`、`qualification`。未发现独立匿名详情接口；申请接口需要登录，适配器不调用或伪造该接口。
- 受控低频复核 `smoke-20260821-jd-01` 返回 18 页、1751 条原始记录，但唯一 ID 为 1747，重复 4 条（包括 `221691` 和 `220127`）。适配器对重复 ID 去重并报告 `partial`，不将无法证明完整覆盖的结果用于关闭既有职位。
- 官方入口可能带 `;jsessionid=...`；公共 `canonicalizeOfficialUrl` 已验证会移除会话段并保留稳定 HTTPS 入口。由于分页完整性门禁未通过，京东保持 `experimental` 且不注册默认 Registry。

## Wave D：阿里巴巴访问 Spike（2026-08-21）

- 官方入口 `https://talent.alibaba.com/off-campus` 的匿名请求返回 HTTP 500 JSON 错误，并给出 HTTP 根地址作为响应位置；未取得职位列表响应。
- 根地址返回 HTTP 200，但标题为 `Index of Template Application`，HTML 只有空的 `#app` 挂载节点和前端资源，没有可验证的职位 DOM、稳定 ID、分页集合或详情/投递 URL。
- 当时按 FPS-002/003 不猜测历史接口、不逆向伪造官网前端参数，因此阿里巴巴在该次旧入口复核中保持 `blocked`；该历史结论已由下方 2026-08-22 校园入口复核替代。

### 当前校园入口复核（2026-08-22）

- 阿里巴巴校园实习入口 `https://campus-talent.alibaba.com/campus/position?batchId=100000560002` 可由匿名浏览器正常渲染；官网自身请求 `POST /position/search` 返回 `content.datas` 与 `content.totalCount`。按 `pageIndex/pageSize` 驱动 34 页，得到 339 条、339 个唯一稳定 `id`，coverage 为 `complete`。
- 华为校园实习入口 `https://career.huawei.com/cn/campus-recruitment-job-list?recruitmentType=INTERN` 可由匿名浏览器正常渲染；官网自身网关请求返回 `data.result` 与 `data.pageVO`。按 `curPage/pageSize` 驱动 4 页，得到 31 条、31 个唯一稳定 `jobId`，coverage 为 `complete`。
- 两个来源均未复制 Cookie、CSRF、动态签名或登录状态；页面出现验证码、登录或访问验证时仍按 `access_blocked` 降级。

### JD 与拼多多脚本复核（2026-08-22）

- 京东校园脚本的 `POST https://campus.jd.com/api/wx/position/page?type=present` 使用 `pageSize/pageIndex/parameter.planIdList`；匿名响应 `body.totalNumber=75`、`body.items` 返回 75 条，`publishId` 无重复，字段归一化通过。
- 拼多多实习脚本的 `POST https://careers.pddglobalhr.com/api/careers/api/recruit/position/train/list` 使用 `page/pageSize/t`；匿名响应 `result.total=2`、`result.list` 返回 2 条，ID 无重复，字段归一化通过。
- 拼多多社会招聘接口仍需要 `anti_content`，本次只将实习脚本对应来源标记为 `supported`，不扩大为社会招聘支持。

## Wave E：百度社招路由 Spike（2026-08-21）

- 官方入口 `https://talent.baidu.com/jobs/social` 返回 HTTP 200，但页面标题为“百度校园招聘”，与社招目录不一致；页面公开的 `/social-list` 路由匿名访问返回 `need-login`。
- 官网前端公开使用的列表路径为 `/httservice/getPostListNew`；在不携带登录状态的受控请求中，按页面脚本参数调用返回 `Illegal argument: recruitType`，没有取得职位列表。
- 未取得匿名社招职位集合、稳定 ID、详情和完整分页证据；不复用登录 Cookie，不猜测或伪造参数。百度提交范围例外，保持 `blocked`，不创建适配器、不注册默认 Registry。

### 百度校招协议复核（2026-08-22）

- 校招入口 `https://talent.baidu.com/jobs/list?recruitType=INTERN` 的 SSR HTML 与公开脚本确认列表调用为 `POST /httservice/getPostListNew`；打开开发者工具后页面跳转 `about:blank`，但普通匿名 HTTP 协议不受影响。
- 请求必须使用 `application/x-www-form-urlencoded;charset=utf-8`，`pageSize` 最大为 20；按 `recruitType=INTERN/GRADUATE`、`curPage` 分页。此前 `Illegal argument` 分别由错误的 JSON 媒体类型和超限 `pageSize=100` 导致，并非登录或签名阻断。
- 列表响应内联职责和任职要求，使用 `postId` 作为稳定 ID，详情 URL 为 `/jobs/detail/{recruitType}/{postId}`，无需 DOM 定位或独立详情请求。
- `smoke-20260822-baidu-01` 共采集 31 页/617 条，其中实习 458、应届 159，617 个 ID 唯一且 coverage 为 `complete`；百度校招晋级 `supported` 并默认启用。

## Wave F：得物权威入口与浏览器 Spike（2026-08-21）

- 历史复核中，`https://careers.dewu.com/index/` 的官方页面导航明确区分“社会招聘”和指向 `https://campus.dewu.com` 的“校园招聘”；社会招聘列表可匿名打开，页面显示 `589` 个职位和 `59` 页，并有“实习专区”筛选。
- 职位详情链接形如 `/index/position/{numeric-id}/detail`，受控页面可读取职位名称、地点、雇佣类型、职责和要求；首个实习样本为“发布器产品经理实习生”。
- 官网自身前端调用 Feishu ATS `/api/v1/search/job/posts` 和 `/api/v1/job/posts/{id}`，裸 HTTP 调用返回 405，前端会为请求生成签名。项目不伪造签名或复用登录 Cookie，暂不实现 HTTP 适配器。
- 结论：历史证据曾建立得物官方关系与匿名可见范围，但当前入口已失效；浏览器全量分页、重复 ID、取消/超时和资源回收门禁未完成，保持 `experimental`，不注册默认 Registry。
- 补充复核（2026-08-21）：普通匿名 HTTP GET 访问原入口返回 HTTP 404，响应无标题和脚本；这使得旧页面证据失效，需重新确认官方入口后才能继续浏览器 Spike，当前仍保持 `experimental`。
- 校园入口复核（2026-08-21）：历史证据中的 `https://campus.dewu.com` 同样返回 HTTP 404，响应无标题、脚本或职位线索；未猜测其他入口，继续保持 `experimental`。

## 4. 证据保留要求

实现 Spike 必须补充：

- 复核日期和最终规范入口。
- 列表、详情、分页和投递 URL 的公开可见证据。
- 是否完整覆盖职位集合的判断依据。
- 限流、登录、验证码和地区限制。
- 稳定外部 ID 方案。
- 至少一个脱敏列表样本、一个详情样本和一个关闭/不存在样本（能合法取得时）。
- 样本 SHA-256 与媒体类型；不得提交 Cookie、Token、手机号、邮箱或候选人信息。

接口路径、请求体和响应字段属于适配器实现资料，在复核前不得写入稳定总体架构。
