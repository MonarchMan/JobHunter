# 019 非 supported 官网渠道研究台账

> 最近更新：2026-08-28

## Experimental（9）

| 渠道       | 当前证据                    | 阻断点                                                                    | 下一步 |
| ---------- | --------------------------- | ------------------------------------------------------------------------- | ------ |
| 阿里实习   | 2026-08-28 已晋级 supported | 校园物理列表首页/中间页/末页 smoke 与记录类别筛选通过                     | 已完成 |
| 字节实习   | 2026-08-28 已晋级 supported | 校园物理列表首页/中间页/末页 smoke 与记录类别筛选通过                     | 已完成 |
| 得物实习   | 2026-08-28 已晋级 supported | 飞书 ATS 校园列表边界 smoke 与记录类别筛选通过                            | 已完成 |
| 小红书实习 | 2026-08-28 已晋级 supported | 匿名 JSON 完整物理列表与独立实习筛选门禁通过                              | 已完成 |
| 京东社招   | 2026-08-28 已晋级 supported | 首页/末页总数、边界长度、样本唯一 ID 与归一化通过；全量重复仍报告 partial | 已完成 |
| 小米实习   | 2026-08-28 已晋级 supported | 匿名浏览器结构化 JSON 边界 smoke、样本唯一 ID、深链与归一化通过           | 已完成 |
| 360 社招   | 2026-08-28 已晋级 supported | 匿名列表与官方详情 API、职责要求、经验、深链及归一化通过                  | 已完成 |
| 网易实习   | 2026-08-28 已晋级 supported | 匿名浏览器混合 JSON 边界 smoke 与记录级实习筛选通过                       | 已完成 |
| 网易社招   | 2026-08-28 已晋级 supported | 匿名浏览器混合 JSON 边界 smoke 与记录级社招筛选通过                       | 已完成 |

## Blocked（20）

| 公司   | 渠道       | 当前事实                    | 首选研究路径                                                                                                  |
| ------ | ---------- | --------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 腾讯   | 校招       | 2026-08-28 已晋级 supported | `projectMappingId=1` 返回 103 个应届岗位；2 页、唯一 postId、详情与归一化在线门禁通过                         |
| 阿里   | 社招       | 2026-08-28 已晋级 supported | 控股集团官网 off-campus JSON 首页/中间页/末页、唯一 ID、深链与 social 归一化通过                              |
| 百度   | 社招       | 2026-08-28 已晋级 supported | SOCIAL 匿名 JSON 采集 1,639 个岗位、82 页，完整分页、唯一 postId 与归一化通过                                 |
| 拼多多 | 校招       | 2026-08-28 已晋级 supported | grad 官方 JSON 两页通过；稳定 ID、岗位深链和 campus 归一化通过                                                |
| 拼多多 | 社招       | blocked                     | 普通 Chrome 空白 profile + 首屏后 CDP 附加连续三轮首页/末页/详情 smoke 通过；待实现专用 session-driven driver |
| 美团   | 校招       | 2026-08-28 已晋级 supported | `jobType=1` 返回 185 个正式岗位；单页 200 条、唯一 jobUnionId、详情与归一化通过                               |
| 得物   | 社招       | 2026-08-28 已晋级 supported | Experienced 飞书 ATS 浏览器 JSON 首页/中间页/末页、唯一 ID 与 social 归一化通过                               |
| 小红书 | 社招       | 2026-08-28 已晋级 supported | `recruitType=social` 匿名 JSON 首页/末页、唯一 positionId 与归一化通过                                        |
| 京东   | 校招       | 2026-08-28 已晋级 supported | 正式计划 47/56/57/58 首页/末页、唯一 publishId 与 campus 归一化通过                                           |
| 华为   | 校招、社招 | 2026-08-28 已晋级 supported | 校招使用无 recruitmentType 的校园列表；社招使用 `newHr` 匿名 JSON；边界、唯一 ID、深链与归一化通过            |
| 小米   | 校招、社招 | 2026-08-28 已晋级 supported | 匿名浏览器分别捕获 `type=2/1`；首页/中间页/末页、唯一 jobPostId、深链与类别归一化通过                         |
| vivo   | 实习、校招 | 2026-08-28 已晋级 supported | 校园官网 `Category=3/2` 分别返回 92/164 个岗位；单页全量、唯一 UUID、岗位深链与归一化在线门禁通过             |
| OPPO   | 校招、社招 | 2026-08-28 已晋级 supported | 校招项目 30/31 共 140 个岗位；社招匿名 ATS API 139 个岗位；均完成单页全量、稳定 ID、深链与归一化门禁          |
| 360    | 实习、校招 | 2026-08-28 已晋级 supported | `campus.360.cn` 迁移北森；Category=3/2 各以两页完成唯一 UUID、深链与归一化门禁                                |
| 网易   | 校招       | 2026-08-28 已晋级 supported | 互联网 103、游戏 102、雷火 77 三个物理来源各自两页、唯一 ID、深链与 campus 归一化通过                         |

## 拼多多社招专项调研

### 已确认的官网协议

- 唯一完整列表是 `POST https://careers.pddglobalhr.com/api/recruit/position/list`，请求体包含 `job`、`page`、`pageSize`、`name`、`workLocationList` 和官网脚本现场生成的 `anti_content`。
- 列表成功结果由 `list` 与 `total` 组成；列表卡片至少使用 `code`、`name`、`job`、`workLocation` 和 `updateTime`，岗位深链为 `/jobs/detail?code={code}`。
- 详情使用 `POST /api/recruit/position/detail`，同样要求新生成的 `anti_content`；详情页使用 `jobDuty`、`serveRequirement`、`bonus` 等字段。因此只取得列表或热门岗位代码，不能满足当前职位正文契约。
- 官网脚本先请求 `/api/careers/server/_stm` 取得服务端时间，再结合浏览器环境生成 `anti_content`；同时访问 `xg.pinduoduo.com/xg/pfb/*` 风控服务。当前失败不是漏传普通 header 或漏调公开初始化接口。
- `/api/recruit/position/latest_list`、`/api/recruit/job/query/list` 和 `/api/recruit/position/workLocation/list` 可匿名访问，但前者只返回最新/热门岗位摘要，后两者只是筛选元数据，三者都不能替代完整列表与详情。

### 公开实现复核

- [FindJobs-Agent 的拼多多实现](https://github.com/he-yufeng/FindJobs-Agent/blob/main/job_crawler.py#L3219-L3297)调用旧的 `GET /api/position/list?page=...`，返回结构也与当前官网不符；2026-08-28 实测为 403。该仓库后续提交说明其 20 个爬虫仅 4 个仍健康，因此不能作为接入依据。
- 网上可找到通过修改 `navigator.webdriver`、伪造 Chrome 插件、提取混淆函数及复用浏览器 Cookie 来生成 `anti_content` 的逆向方案；其中 stealth、用户 Cookie 和验证码规避仍违反 SSR-003，不纳入候选。SSR-T008 只研究能否原样运行官网公开签名模块，并保留失败即回退的边界。

### `anti_content` 签名 Spike（2026-08-28）

- 当前社招页面加载 `_app-3abf0c1e9008cfdd.js`，原始 SHA-256 为 `40eac6ca03f3b43f56217276a7515ea4de364113c4f0b2d1f17a7ec58ccbb9e9`；签名入口经 webpack 模块 `81751 -> 70290` 装载。
- 官网包装器的明确调用链为：请求 `api/careers/server/_stm` -> 创建或复用 risk crawler -> `updateServerTime(server_time)` -> `messagePackSync()` -> 将结果写入请求体 `anti_content`。列表与详情走同一包装器。
- 内嵌模块不是纯函数：静态拆包确认其读取 `window`、`document`、`navigator`、`localStorage`、`indexedDB`、MutationObserver、浏览器尺寸、页面/事件缓存和指纹数据，并与 `xg.pinduoduo.com/xg/pfb/*` 协作。
- 在一个无登录、无用户 Cookie、无 stealth 的空白 Chrome 会话中，两次不同详情请求产生长度 400 和 418 的 token，摘要不同；未保存 token 明文。token 至少具有逐请求变化，固定值重放不成立。
- 三条实现路线的复杂度依次为：在官网页面内调用原始模块；把原始模块及所需浏览器状态封装进短生命周期隔离运行时；清洁重写算法。当前只保留前两条继续验证，第三条会复制风控实现、维护成本最高，不作为默认方向。

### 签名运行时实验结果（2026-08-28）

1. **Webpack runtime bridge 通过**：普通 Chrome 首屏完成后，从 Next.js runtime 取得 `81751 -> 70290 -> 34155` 三个原始模块；直接调用 `messagePackSync()` 连续得到 378/375 字符的不同 token，不需要修改 `navigator.webdriver`。
2. **最小浏览器运行时通过**：第一会话只负责取得三个 factory 源码并关闭；第二个全新空白 profile 直接打开 `_stm` JSON 页面，没有 Next.js runtime、招聘 UI 或上一会话 Cookie。注入原始 factory 后生成 391 字符 token，列表返回 HTTP 200、`success=true`、总数 798。
3. **Node + DOM shim 停止**：补齐标准 JS 全局后，模块加载立即读取 `screen.availWidth`；静态分析还确认 navigator、存储、事件、浏览器尺寸与指纹依赖。继续推进必须伪造屏幕/浏览器环境，触达 SSR-003 停止条件；没有向官网发送 Node shim 生成的 token。
4. **最小 headful 三轮通过**：三个独立空白 profile 均只打开 `_stm`，每轮请求首页、末页和一条详情；总数均为 798，首页 10 条、末页第 80 页 8 条，详情 `T013636` 的职责、要求和加分项完整，9 个 token 摘要全部不同。
5. **原生 headless 三轮通过**：Chrome 由外部进程以 `--headless=new` 启动，Playwright 仅通过 CDP 附加；三轮结果与 headful 相同，`navigator.webdriver=false`，9 个 token 全部逐请求变化。这证明生产候选不需要可见窗口，但仍需要真实 Chrome 运行时。
6. **静态 bundle 抽取部分通过**：Node 从 jobs HTML 定位当前 `_app` bundle，用 AST 直接抽取三个 module factory，不再需要 headful 引导；在 headless 最小运行时中前两轮完整通过，第三轮首页返回 `errorCode=54001`。随后单轮复核仍为 `54001`，完整官网 headful 页面同期也显示 0 个职位，说明本轮连续实验已触发上游临时风险/频控，不能据此判定静态抽取错误，也不能宣称 3/3 稳定。

当前结论是：纯 Node generator 在不伪造指纹的约束下不可行；`公开 bundle 静态抽取 + 原生 headless Chrome 最小同源运行时 + Playwright CDP` 是主候选，完整官网页面的普通 Chrome + CDP 是 fallback。两者共享上游风控故障域，`54001`、`400023`、验证码或官网 0 职位异常必须触发断路，不得快速重试或把 0 当作成功。待风险窗口冷却后，静态抽取路径还需重新完成三轮独立 smoke，当前渠道继续 blocked。

### 候选实现与结论

| 方案                         | 完整列表 | 完整详情 | 合规性           | 稳定性         | 结论                                              |
| ---------------------------- | -------- | -------- | ---------------- | -------------- | ------------------------------------------------- |
| 官方授权 API/职位 Feed       | 是       | 是       | 最佳             | 取决于官方 SLA | 首选；需要拼多多招聘或技术接口方提供              |
| 官网驱动的交互式浏览器采集   | 是       | 是       | 有条件合规       | 三轮实验通过   | 可实施；待工程化并接入 Worker                     |
| `latest_list` 热门/最新摘要  | 否       | 否       | 合规             | 当前可用       | 只能新增 optional 摘要源，不能解除 blocked        |
| 搜索引擎索引或第三方招聘平台 | 不可证明 | 不可证明 | 违反官方来源范围 | 不可控         | 排除                                              |
| 官网原始签名模块隔离运行     | 待验证   | 待验证   | 受 SSR-003 限制  | 尚未证明       | Spike；不得加入 stealth、用户 Cookie 或验证码规避 |
| 清洁重写/伪造 `anti_content` | 理论可行 | 理论可行 | 高风险           | 高维护、易失效 | 不作为默认方向                                    |

### 推荐实施路径

1. 先向拼多多招聘接口方申请只读职位 Feed、服务账号或允许的机器访问方式；确认分页、详情、限流、使用条款及稳定 ID。拿到授权后新增独立 `pinduoduo.social` 物理 source，并按首页/末页 smoke 晋级。
2. 先完成 SSR-T008：验证官网原始签名模块能否在不修改浏览器指纹、不导入用户 Cookie 的隔离运行时中逐请求工作；以 bundle 摘要和三轮匿名 smoke 证明可重复性，单次成功不晋级。
3. 若签名模块不能稳定抽离，则实现专用的 session-driven fallback：普通 Chrome 使用空白 profile 完成首屏初始化，Playwright 仅在之后通过 CDP 接管；由官网页面自己发起列表和详情请求，翻页必须点击官网分页控件产生新 token，禁止复用首个请求的 `anti_content`。
4. 两种方案都采用隔离的空白匿名状态，不挂接用户日常 profile、不注入 stealth 脚本、不导入候选人 Cookie；出现验证码、`400023` 或验证事件立即返回 `access_blocked`。
5. 在目标部署环境执行三轮独立 2–3 页 smoke，每轮覆盖首页、末页和可选中间页，并抽查岗位详情；只有三轮均通过、样本 ID 唯一且总数一致时才注册并晋级 supported。
6. Playwright 直接 launch 的 headless 重载 5/5、headful 会话 3/3 失败；普通 Chrome 空白 profile 先加载、CDP 后附加的三轮独立实验全部成功。fallback 必须保留这一启动顺序，不能退回 `chromium.launch()`。
