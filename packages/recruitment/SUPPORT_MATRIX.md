# 官网来源支持矩阵

> 发布记录日期：2026-09-11（既有来源验证日期见明细）

## 三渠道完整性

每家公司都拥有稳定的实习、校招、社招逻辑渠道；逻辑渠道下可以有零个、一个或多个物理官网来源。`blocked` 表示 required 物理来源为空或全部受阻，不再通过占位 adapter 凑齐矩阵，也不会产生空列表成功。

| 公司     | 实习      | 校招      | 社招      |
| -------- | --------- | --------- | --------- |
| 腾讯     | supported | supported | supported |
| 阿里巴巴 | supported | supported | supported |
| 百度     | supported | supported | supported |
| 字节跳动 | supported | supported | supported |
| 拼多多   | supported | supported | blocked   |
| 美团     | supported | supported | supported |
| 得物     | supported | supported | supported |
| 小红书   | supported | supported | supported |
| 京东     | supported | supported | supported |
| 华为     | supported | supported | supported |
| 小米     | supported | supported | supported |
| vivo     | supported | supported | supported |
| OPPO     | supported | supported | supported |
| 360      | supported | supported | supported |
| 网易     | supported | supported | supported |
| 快手     | supported | supported | supported |
| 哔哩哔哩 | blocked   | blocked   | supported |
| 滴滴     | supported | supported | supported |
| 携程     | supported | supported | supported |
| 米哈游   | supported | supported | supported |

网易校招逻辑渠道声明互联网、游戏和雷火三个独立物理官网入口，分别保留支持状态、健康和同步历史；三者均已通过两页边界 smoke。原 15 家公司中唯一 blocked 渠道为拼多多社招：官网原始 `anti_content` 模块已在最小 headful 和原生 headless Chrome 中分别完成三轮首页/末页/详情 smoke，普通 Chrome 完整页面 + Playwright CDP 保留为 fallback；纯 Node shim 因需要伪造浏览器指纹而停止。静态 bundle 抽取路径在第三轮触发 `54001`，同期完整官网也进入 0 职位异常，待风险窗口冷却后仍需补三轮复核；尚未工程化和注册，不能提前标记 supported。

2026-09-11 新增五家公司共 15 个逻辑渠道。B 站社招、快手三渠道、滴滴四个物理来源、携程三渠道及米哈游三渠道已工程化。滴滴实习与常规校招通过独立边界/详情 smoke；社招经用户手动确认官网分页缺陷后明确验收 supported，保留 partial 保护；未来精英无真实详情，仍 experimental/default off。其余 2 个新增逻辑渠道（B 站校园/实习）仍无适配器。blocked 表示待接入，不代表已确认官网拦截；详见 [第二批研究台账](../../specs/026-official-source-wave-two/research.md)。目录合计 20 家公司、60 个逻辑渠道、62 个物理来源。

## 已验证来源明细

米哈游：`mihoyo.social`、`mihoyo.intern`、`mihoyo.campus` 均 `1.0.0 / supported`。2026-09-11 独立生产首尾页/一详情 smoke 通过：社招 662（1/67，10/2）、校园实习 144（1/15，10/4）、应届校招 118（1/12，10/8）。社招包括第三方编制，保留用工性质，不冒充直聘；校园按 hireType/jobNatures 拆分，不写死届次或项目 ID。匿名 HTTP 无需浏览器/凭据，required 详情失败不写占位。采样均 partial/sampled_pages，未运行全量在线门禁。物理来源默认开，逻辑渠道仍仅实习默认开；社招实习当前零岗位，不将未验证独立入口列入支持范围。

携程：`ctrip.social`、`ctrip.intern`、`ctrip.campus` 均为 `1.0.0 / supported`，分别覆盖社会正式岗位、日常实习和应届校招。2026-09-11 15:55 CST 独立生产 smoke 3/3：社招 total=487（页 1/49，10/7 条）、实习 total=25（页 1/3，10/5 条）、校招 total=57（页 1/6，10/7 条），各独立验证一条详情。匿名 HTTP，仅固定中文展示偏好 `language=zh-CN`，无需浏览器、账号或签名；正文内联，所有采样均为 partial/sampled_pages，未执行全量采集。当前未开放留用实习不在支持范围，其他独立品牌/国际站未声明覆盖。物理来源默认启用，逻辑渠道仍仅实习默认开，既有运行开关不重置。

滴滴三个逻辑渠道均 supported，`didi.social`、`didi.intern` 与 `didi.campus` 物理来源默认启用；既有运行开关不重置。未来精英仍为校招 supplemental 来源，experimental/default off。社招列表及详情可读取，用户手动确认官网第 65 页异常后明确验收 supported；已知上游缺陷为总数 1039 时末页应有 15 条、实际只有 1 条。支持状态不代表完整性通过：仍严格检查 page/size、保留 partial/invalid_page_boundary，不缩减总数、不执行缺失下线。社招/实习采用 required 详情，正文失败不写占位；空地点沿用应用未知地区跳过策略。不包含国际招聘站，详细证据见研究台账。

快手：`kuaishou.social`、`kuaishou.intern`、`kuaishou.intern.campus`、`kuaishou.campus` 均为 `1.0.0 / supported`。2026-09-11 四项独立生产 smoke 通过：社招 1254（页 1/26）、日常实习 1113（页 1/23）、校园实习 225（页 1/5）、应届校招 266（页 1/6）。每页 50 条，各核对一条官方详情；均 `partial + sampled_pages`，不推断已采全量。普通匿名浏览器调用官网原始模块，每次调用间隔至少 5 秒，无小号、登录态或 CDP 常驻进程；校园届次动态发现。物理来源默认开，逻辑渠道沿用仅实习默认开的规则。

B 站社招：`bilibili.social@1.0.0`，supported，物理来源默认启用。2026-09-11 生产配置每页 50 条、匿名会话 JSON 串行重放（至少间隔 5 秒），首页/末页和独立详情 smoke 通过；全样本归一化、官方深链、职责要求、ID 唯一性通过，采样明确为 `partial + sampled_pages`，没有运行全量在线遍历。

| 来源           | 支持状态  | 默认启用 | 适配器                          | 当日在线门禁 | 说明                                                                                                                          |
| -------------- | --------- | -------- | ------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| 腾讯社招       | supported | 是       | `tencent.social@1.0.0`          | 通过         | `smoke-20260820-tencent-01`；公开匿名职位 2275，coverage `complete`，全量分页+一条详情规范化，121.91s                         |
| 腾讯实习       | supported | 是       | `tencent.intern@1.0.0`          | 通过         | 校园官网按应届实习、日常实习及青云实习筛选；列表分页与详情响应已验证                                                          |
| 腾讯校招       | supported | 是       | `tencent.campus@1.0.0`          | 通过         | 2026-08-28 `projectMappingId=1` 返回 103 个应届岗位；2 页、唯一 `postId`、详情与归一化通过                                    |
| 拼多多实习     | supported | 是       | `pinduoduo.intern@1.0.0`        | 通过         | `smoke-20260822-pinduoduo-01`；实习接口匿名返回 2 条、1 页，coverage `complete`，稳定 ID 和字段归一化通过；社招风控接口不接入 |
| 字节跳动社招   | supported | 是       | `bytedance.social@1.0.0`        | 通过         | 匿名浏览器由官网脚本生成运行时 `_signature`；响应 `count/limit/offset` 分页、稳定 ID、官方详情 URL 和归一化已通过 Smoke       |
| 字节跳动校招   | supported | 是       | `bytedance.campus@1.0.0`        | 通过         | 校园入口 `portal_type=3`，当前响应同时包含日常实习、ByteIntern 与校园项目                                                     |
| 字节跳动实习   | supported | 是       | `bytedance.intern@1.0.0`        | 通过         | 2026-08-28 校园物理列表首页/中间页/末页 smoke 通过；按记录级类别筛选，样本 ID 唯一且均归一化为 internship                     |
| 美团社招       | supported | 是       | `meituan.social@1.0.0`          | 通过         | `smoke-20260821-meituan-01`；匿名 24 页/2349 条全量分页、详情和离线契约通过，默认低频串行                                     |
| 美团实习       | supported | 是       | `meituan.intern@1.0.0`          | 通过         | 校园页初始化匿名会话后按 `jobType=2` 请求官方 JSON，响应驱动分页                                                              |
| 美团校招       | supported | 是       | `meituan.campus@1.0.0`          | 通过         | 2026-08-28 `jobType=1` 返回 185 个正式岗位；单页 200 条避免跨页漂移，唯一 `jobUnionId`、详情与归一化通过                      |
| 小红书校招     | supported | 是       | `xiaohongshu.campus@1.0.0`      | 通过         | 匿名返回 387 条，4 页分页、稳定 ID、字段归一化和在线 Smoke 已通过，默认每页 100 条低频串行                                    |
| 京东实习       | supported | 是       | `jd.intern@1.0.0`               | 通过         | `smoke-20260822-jd-01`；校园接口匿名返回 75 条实习职位、1 页，coverage `complete`，稳定 `publishId` 和字段归一化通过          |
| 京东社招       | supported | 是       | `jd.social@1.0.0`               | 通过         | 2026-08-28 首页/末页 smoke 通过；总数与末页长度一致，样本 `requirementId` 唯一并完成归一化；全量重复仍报告 partial            |
| 阿里巴巴校招   | supported | 是       | `alibaba.campus@1.0.0`          | 通过         | `smoke-20260822-alibaba-01`；匿名浏览器采集 339 条、34 页，coverage `complete`，339 个稳定 ID，字段归一化通过                 |
| 阿里巴巴实习   | supported | 是       | `alibaba.intern@1.0.0`          | 通过         | 2026-08-28 校园物理列表首页/中间页/末页 smoke 通过；按记录级类别筛选，样本 ID 唯一且均归一化为 internship                     |
| 百度校招       | supported | 是       | `baidu.campus@1.0.0`            | 通过         | `smoke-20260822-baidu-01`；匿名表单 JSON 接口采集实习 458、应届 159，共 617 条/31 页，coverage `complete`，稳定 ID 唯一       |
| 百度社招       | supported | 是       | `baidu.social@1.0.0`            | 通过         | 2026-08-28 SOCIAL 匿名表单 JSON 采集 1,639 个岗位、82 页，coverage `complete`，稳定 `postId` 唯一                             |
| 得物校招       | supported | 是       | `dewu.campus@1.0.0`             | 通过         | 匿名浏览器由官网脚本生成运行时 `_signature`；校招/实习筛选返回 6 条、1 页，稳定 ID、官方详情 URL 和归一化已通过 Smoke         |
| 华为实习       | supported | 是       | `huawei.intern@1.0.0`           | 通过         | `smoke-20260822-huawei-01`；匿名实习页采集 31 条、4 页，coverage `complete`，31 个稳定 ID，字段归一化通过                     |
| 小米实习       | supported | 是       | `xiaomi.intern@1.0.0`           | 通过         | 2026-08-28 匿名浏览器捕获官网 JSON 的首页/中间页/末页；样本 `jobPostId` 唯一、深链与 internship 归一化通过                    |
| vivo 社招      | supported | 是       | `vivo.social@1.0.0`             | 通过         | 2026-08-28 匿名 JSON 全量分页、稳定 ID、岗位级深链和归一化通过                                                                |
| vivo 实习      | supported | 是       | `vivo.intern@1.0.0`             | 通过         | 2026-08-28 校园官网 `Category=3` 返回 92 个岗位；单页全量、唯一 UUID、岗位深链与 internship 归一化通过                        |
| vivo 校招      | supported | 是       | `vivo.campus@1.0.0`             | 通过         | 2026-08-28 校园官网 `Category=2` 返回 164 个岗位；单页全量、唯一 UUID、岗位深链与 campus 归一化通过                           |
| OPPO 实习      | supported | 是       | `oppo.intern@1.0.0`             | 通过         | 2026-08-28 Intern 项目 29 匿名 JSON 全量分页、稳定 ID、岗位级深链和归一化通过                                                 |
| OPPO 校招      | supported | 是       | `oppo.campus@1.0.0`             | 通过         | 2026-08-28 Graduate 项目 30 与 doctor 项目 31 共 140 个岗位；单页全量、唯一 `idRecruitPosition` 与 campus 归一化通过          |
| OPPO 社招      | supported | 是       | `oppo.social@1.0.0`             | 通过         | 2026-08-28 `career.oppo.com` 匿名 ATS API 返回 139 个社招岗位；单页全量、唯一 `positionId`、深链与归一化通过                  |
| 得物实习       | supported | 是       | `dewu.intern@1.0.0`             | 通过         | 2026-08-28 飞书 ATS 校园列表不超过三页，边界 smoke 通过；按记录级类别筛选，样本 ID 唯一且均归一化为 internship                |
| 小红书实习     | supported | 是       | `xiaohongshu.intern@1.0.0`      | 通过         | 2026-08-28 匿名 JSON 完整遍历校园物理列表，按记录级类别筛选后的实习集合、唯一 ID 与归一化独立门禁通过                         |
| 360 社招       | supported | 是       | `qihoo360.social@1.0.0`         | 通过         | 2026-08-28 匿名浏览器列表与 `getjobone` 详情 API 通过；稳定 ID、深链、职责要求和经验归一化完成                                |
| 网易实习       | supported | 是       | `netease.intern@1.0.1`          | 通过         | 2026-09-04 浏览器会话按配置 `pageSize=100` 重放 JSON，首页/中间页/末页、唯一 ID、深链、记录级实习筛选与归一化通过             |
| 网易社招       | supported | 是       | `netease.social@1.0.1`          | 通过         | 2026-09-04 浏览器会话按配置 `pageSize=100` 重放 JSON；复用同一混合协议并按记录级社招筛选                                      |
| 小红书社招     | supported | 是       | `xiaohongshu.social@1.0.0`      | 通过         | 2026-08-28 `pageQueryPosition` 匿名 JSON 首页/末页 smoke 通过；总数、末页长度、唯一 `positionId` 与归一化一致                 |
| 京东校招       | supported | 是       | `jd.campus@1.0.0`               | 通过         | 2026-08-28 正式计划 47/56/57/58 首页/末页 smoke 通过；总数、末页长度、唯一 `publishId` 与 campus 归一化一致                   |
| 华为校招       | supported | 是       | `huawei.campus@1.0.0`           | 通过         | 2026-08-28 校园入口匿名浏览器首页/中间页/末页 smoke 通过；正式岗位样本 ID 唯一且归一化为 campus                               |
| 华为社招       | supported | 是       | `huawei.social@1.0.0`           | 通过         | 2026-08-28 `newHr` 匿名 JSON 以 2 条/页完成首页/末页；唯一 `jobId`、详情深链、职责要求和 social 归一化通过                    |
| 小米校招       | supported | 是       | `xiaomi.campus@1.0.0`           | 通过         | 2026-08-28 匿名浏览器捕获 `type=2` JSON 首页/中间页/末页；唯一 `jobPostId`、深链与 campus 归一化通过                          |
| 小米社招       | supported | 是       | `xiaomi.social@1.0.0`           | 通过         | 2026-08-28 匿名浏览器捕获 `type=1` JSON 首页/中间页/末页；唯一 `jobPostId`、深链与 social 归一化通过                          |
| 阿里巴巴社招   | supported | 是       | `alibaba.social@1.0.0`          | 通过         | 2026-08-28 控股集团官网 off-campus JSON 首页/中间页/末页；唯一 ID、岗位深链与 social 归一化通过                               |
| 拼多多校招     | supported | 是       | `pinduoduo.campus@1.0.0`        | 通过         | 2026-08-28 校园官网 grad 正式岗位共两页；总数、唯一 ID、岗位深链与 campus 归一化通过                                          |
| 得物社招       | supported | 是       | `dewu.social@1.0.0`             | 通过         | 2026-08-28 飞书 ATS Experienced 入口首页/中间页/末页；官网动态签名、唯一 ID 与 social 归一化通过                              |
| 360 实习       | supported | 是       | `qihoo360.intern@1.0.0`         | 通过         | 2026-08-28 北森新站 `Category=3` 两页；唯一 UUID、岗位深链与 internship 归一化通过                                            |
| 360 校招       | supported | 是       | `qihoo360.campus@1.0.0`         | 通过         | 2026-08-28 北森新站 `Category=2` 两页；唯一 UUID、岗位深链与 campus 归一化通过                                                |
| 网易互联网校招 | supported | 是       | `netease.campus.internet@1.0.0` | 通过         | 2026-08-28 `projectId=103` 两页；唯一 ID、岗位深链与 campus 归一化通过                                                        |
| 网易游戏校招   | supported | 是       | `netease.campus.games@1.0.0`    | 通过         | 2026-08-28 `projectId=102` 两页；唯一 ID、岗位深链与 campus 归一化通过                                                        |
| 网易雷火校招   | supported | 是       | `netease.campus.leihuo@1.0.0`   | 通过         | 2026-08-28 `project_id=77` 两页；唯一 `ehr_job_id`、岗位深链与 campus 归一化通过                                              |

`supported`、`enabled` 和运行时 `health_status` 是独立维度。未通过在线门禁的 experimental 来源不会默认启用，但已有真实实现的适配器可注册用于诊断和显式实验运行；blocked 且尚无实现的物理来源不注册占位 adapter。

普通 HTTP 无法取得公开数据时，来源可以使用受控浏览器执行官网公开脚本并读取当前匿名会话的渲染结果；不得逆向伪造风控参数、绕过验证码或复用登录 Cookie。浏览器方案不稳定或维护成本过高时保持 `experimental/blocked`，不阻塞其他来源和 Agent 主链路。实验适配器会注册到代码目录，但默认启用仍由支持门禁控制。
