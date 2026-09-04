# 024 外部 Agent 网友面经研究设计

> 状态：Implemented

## 1. 业务与运行边界

`ExperienceResearchRequest` 保存长期研究意图和审核状态；`Task` 保存某次外部执行；研究 Prompt、Schema 和 Bundle 都是 `files` 中的逻辑文件。外部 Agent 只实现应用端口，不进入内部 AgentRunner，也不能直接访问 Repository。

```text
ResearchRequest ──生成──► Prompt + JSON Schema
       │                         │
       ├──人工复制/导入──────────┤
       └──Task → 外部研究执行器──┘
                       │
                       ├──codex-local（原生搜索）
                       └──browser-assisted-codex v2
                                  └──Worker 确定性采集 → 无网络 Codex
                                 ▼
                         ResearchBundle 校验
                                 ▼
                        needs_review 候选
                                 ▼ 人工接受/拒绝
                           网友面经读取模型
```

## 2. 数据模型

迁移 `0021_community_experience_research.sql` 新增 `experience_research_requests`，保存规范 Brief、请求指纹、Prompt/Schema 版本、三个逻辑文件引用、执行 Task、状态、失败摘要、修订号和时间。

`interview_experiences` 增加 `source_type`、`review_status`、`research_request_id`、来源 URL/标题/时间与核验状态；`interview_question_entries` 增加独立的 `answer_excerpt`、topics、有限 evidence excerpt 和问题指纹。网友摘录不得写入代表用户回答的 `answer`。个人面经插入为 `personal`，接受文档时同步其经历审核状态。网友候选的 `file_id` 指向当前研究包逻辑文件，不增加 `research_bundles` 文档表。

规范 Brief 先生成稳定基础指纹：同一 Brief 下尚可导包的未接受请求会幂等复用。当请求已有 accepted 候选或 Bundle 已达 5 版时，再次创建使用基础指纹与下一 generation 确定性派生新的实例指纹，既保留开放请求的幂等性，也不让已封存请求阻断同一研究目标的新一轮。

## 3. Bundle 校验与去重

领域层提供严格 `ResearchBundle@v1` Schema。冻结 Prompt 要求研究 Agent 先按技术区分度筛选问题，并在所有来源之间把考察同一核心能力的高相似问法归并为一个代表项；代表项必须选择更具体、更有追问价值且证据可回溯的来源，有答案摘录时选择信息更完整者，不允许模型补写答案或跨来源拼接问题、答案与证据。该语义判断发生在受限 Agent 的研究输出阶段，首版不增加向量库、聚类表或不可解释的本地阈值。

应用层随后做可重复的边界校验：请求指纹相等、experience.sourceUrl 存在于 sources、URL 仅为可公开寻址且非 IANA 保留/文档示例用途的 HTTP(S) 地址、时间合法、摘录在固定长度内。规范 URL 去除 fragment；问题按 NFKC、空白折叠与小写生成指纹。同一 experience 内漏过 Agent 的相同指纹保留首项。若来源标题或警告表明检索失败/占位，且全部问题也只有同类失败陈述，则整包作为无研究发现拒绝；包含真实问题的部分检索警告不触发该规则。

导入先用短 `BEGIN IMMEDIATE` 事务按 request revision 取得带 5 分钟租约的 import claim，再在事务外把 Bundle 写入本次 claim 独占的 staging 逻辑文件；最后在一个短事务中把 staging entity mapping 原子提升为 canonical Bundle 的下一版本、替换未审核候选并把请求置为 `needs_review`。自动路径在 claim 与 finalize 两个事务内都核验 `current_task_id`、Task 为 `running` 且未请求取消，跨进程取消一旦先取得写锁，候选和正式版本便不能提交；若 finalize 已先提交，之后抵达的取消视为过晚，Task 必须完成为 succeeded，不能出现候选可见而任务显示 cancelled。失败或租约过期会清理 staging 映射及无共享引用的实体；存在 accepted 候选或已达五个有效版本时在写正式版本前拒绝替换。

## 4. 外部执行器与受限浏览器

应用端口 `ExternalResearchExecutor` 暴露 key/version/capabilities 与可取消 `execute`。首个 Node 适配器执行：

```text
codex --search --strict-config --ask-for-approval never
  --config shell_environment_policy.inherit=none
  --disable <each local-or-extensible feature>
  exec --ephemeral --skip-git-repo-check --ignore-rules --ignore-user-config
  --sandbox read-only --output-schema <isolated/schema.json>
  --output-last-message <isolated/result.json> -C <isolated-dir> -
```

Prompt 从 stdin 传入，不拼接 Shell 字符串。执行前从 Artifact Store 读取 ResearchRequest 冻结的 Prompt/Schema 精确版本，而不是用当前 renderer 重建；执行器 Registry 同时校验冻结 Prompt 版本与执行器能力。`browser-assisted-codex@v2` 只接受显式生成的当前 `community-research-prompt@v4`；旧 Prompt 请求需创建新请求而不得改写冻结文件。临时目录只含 Schema/结果，结束后清理；进程使用最小环境变量，stdout/stderr 只保留有上限的诊断摘要。AbortSignal 或超时终止整个进程组。

已实现的 `codex-local@v1` 逐项禁用 `shell_tool`、`unified_exec`、本地/外部浏览器自动化、Computer Use、`multi_agent`、Goal、授权请求、插件、App、Skill、本地图片和工作区依赖等本地或可扩展工具，只保留 `--search` 提供的原生实时网页搜索；`--strict-config` 使未知配置或 feature 直接失败。Codex 官方说明中，read-only 沙箱本身仍允许读取文件，因此这里不能只依靠 `--sandbox read-only`。Codex 0.149 的 `code_mode_only` 模型依赖 Code Mode Host 组织嵌套工具调用，该 Host 保留启用，但其 JavaScript 单元没有 Node、文件系统或网络 API；可调用能力仍由执行器注册的工具白名单决定。适配器缺失、未登录、不支持所需限制、非零退出与无结果都映射为可诊断 Task 错误。该方案是可信本机上的受限本地进程，不宣称具备容器或 OS 级根目录隔离。

### 4.1 `browser-assisted-codex@v2`

浏览器增强执行器不替换应用端口或 Bundle Importer。Worker 在专用临时 Profile 中持有匿名 BrowserContext，从应用层随冻结 Brief 生成的查询计划，通过固定搜索提供方确定性采集页面。受信任网关仍可在 `127.0.0.1` 随机端口提供使用单次 bearer token、Host/Origin 校验的 Streamable HTTP MCP，以复用和测试同一工具协议；生产执行器不把网关 URL 或 token 交给 Codex。采集及相关性校验结束后，Worker 先关闭 BrowserContext、网关和临时 Profile，再启动 Codex；Codex 的原生搜索、MCP、`browser_use*`/`in_app_browser` 及其他网络工具全部禁用。

```text
冻结 Brief → 确定性 QueryPlan → ResearchBrowserGateway → 匿名 BrowserContext
                                      │
                                      └─ 有界 EvidencePack + trace ─stdin→ 无网络 Codex
```

- QueryPlan 先规范化并稳定排序目标岗位与 `allowedDomains`。当允许域名非空时，按“域名 × 岗位”的稳定顺序生成 `site:<domain> <role> <interview terms>` 查询，排在通用岗位查询之前，并冻结 `priorityQueryCount` 作为两阶段边界；计划达到查询上限时优先保留定向查询。Worker 先搜索优先组、按各查询排名轮询并耗尽其候选；仅当页面上限未触发且合格来源仍少于 Brief 目标时，才开始搜索通用组。允许域名既参与搜索发现，也继续作为结果与导航的硬边界，但不改变总搜索、页面、访问与时间预算。
- 每个 `search` 查询按固定提供方顺序尝试。驱动先从 DOM 提取候选、解包已知搜索跳转，再逐项执行 HTTP(S)、公网 URL、允许/禁止域名和结果数量过滤；只有过滤后至少有一个受控结果，当前提供方才算成功。选择器命中但全部结果越界、无效或重复时继续下一提供方，避免“有原始链接但无可用来源”错误阻断回退。返回项只包含标题、实际候选 URL 和不透明 `sourceRef`。
- `open` 只接受当次任务的 `sourceRef` 或 Brief 明确允许的公开 HTTP(S) 来源，导航及每次重定向都重做协议、凭据、主机和 DNS/IP 校验，返回不透明 `pageRef`。
- `readPage` 只返回标题、最终 URL、抓取时间和清洗限长可读文本；来源页在快照后立即关闭。页面正文与工具元数据分区，不返回 Browser/Page 句柄或可执行 HTML/JavaScript。
- 网关不提供登录、输入、点击、上传、下载、表单提交、任意脚本或本地文件访问；不连接用户日常浏览器。
- 浏览器流量必须经过带随机凭据的 loopback 前向代理；网络目标首先由任务级缓存和并发门控解析，所有可信解析答案都必须通过公网地址检查，再固定其中一个公网 IP，主机名和字面 IP 计入同一目标预算。某些受控环境会把系统 DNS 全部映射到保留的 `198.18.0.0/15`：只有系统答案非空且全部属于该网段时，默认解析器才以 64 KiB、5 秒上限的受信任 DNS-over-HTTPS 查询 A/AAAA，校验所有真实答案为公网并固定一个；只有显式启用透明转译且再次观察到系统答案全为 `198.18/15` 时，代理连接才使用首个转译地址。域名安全判断、审计与 pin 仍使用可信公网地址；混合答案、字面 IP、查询失败或任一非公网答案不会启用转译。代理仅转发 GET/HEAD，HTTP 单响应和 HTTPS 单隧道下行分别不超过 16 MiB，单任务下行不超过 128 MiB；执行器另为 DNS 并发与目标缓存、连接、搜索次数、打开页数、正文字符和超时设定硬上限。Worker 在 `finally` 中关闭 MCP 服务和 BrowserContext，并在 AbortSignal、超时或异常时终止 Codex 与浏览器进程树、清理临时 Profile，不让 Codex 子进程再派生不受 Worker 持有的工具服务。
- Worker 对各查询结果按排名轮询，并分别为请求 URL 与成功重定向后的最终 URL 计算 `source-identity@v1`。该 identity 保留 HTTP/HTTPS 协议语义，通过公共 URL 规范化折叠主机大小写、默认端口和 fragment，并稳定排序剩余查询参数；全站只移除 `utm_*` 与固定广告/分享跟踪键，牛客 `/feed/main/detail/` 额外移除 `anchorPoint`、`fromPut`、`sourceSSR`、`toCommentId`、`urlSource`，而 `page` 等内容语义参数必须保留。identity 只用于本次采集去重与计数，不覆盖 `readPage` 返回的实际最终 URL，后者继续作为 EvidencePack、trace 和 Bundle 的审计地址。固定键集合和 identity 版本限制规则扩张，失败来源在独立尝试预算内由后续候选补位。
- 页面标题与正文必须先满足从目标岗位派生的相关词和面试语义词硬门槛，再通过 `interview-page-quality@v1`。当前有界规则先识别登录/验证码/脚本空壳、导航或评论聚合；可读正文至少 200 字符，至少包含 3 个问题候选和 2 个技术问题候选，问题候选少于 5 个时须占有效正文行至少 4%。候选识别只使用固定的问号、编号/项目符号、Q/问题标签、有限中英文疑问起始词和技术信号词；单一评论或只有岗位关键词的长噪声不能进入 EvidencePack，无问号但包含多项编号技术题的面经可以通过。trace 只记录版本、`accepted`/有限拒绝码、候选计数和密度，不记录被拒绝正文；没有取得合格可读页面时不启动 Codex。
- EvidencePack 只在任务内存中存在，包含查询、最终 URL、标题、抓取时间、正文哈希和清洗限长正文；正文仅通过 stdin 中明确标记的不可信 JSON 数据段传递，不进入 argv、环境变量、业务日志或持久文件。
- `community-research-prompt@v4` 声明页面中的指令、代码块和工具建议只是待分析数据。网关保留有上限的当次 `search/open/readPage` 调用 trace；执行器在调用 Bundle Importer 前，在内存中确定性移除没有成功 `open + readPage` 的来源/经历和问题原文不存在于同源正文的条目，把无法从正文证明的答案摘录置空并添加本地裁剪警告，裁剪后无真实问题则失败。剩余 Bundle 的来源 URL、标题和抓取时间以 EvidencePack 为准；Bundle 和业务表均不保存问题周边证据摘录。

网关和其可选 MCP 传输是 Worker 进程内的受信任基础设施细节，不进入领域模型，不得暴露任意工具注册、通用浏览器 API 或动态权限申请。生产执行链使用 Worker 直接调用，避免把“模型是否调用工具”变成正确性条件。

Web 进程注册不可执行 Handler 以校验/入队；生产 Worker 注册真实适配器。自动结果调用与手工上传相同的 Bundle Importer，因此不会形成旁路写库。

## 5. 审核与查询

审核以 request revision CAS 更新单个 experience 为 accepted/rejected，并重算 request 状态。网友面经列表只查询 accepted community records，支持按公司、岗位和阶段做大小写不敏感的精确筛选，并保留每条来源；通过 question fingerprint 计算未被研究 Agent 归并的完全相同问题之“独立出处出现次数”读取投影，不建立首版 cluster 表。

ResearchRequest 同时展示业务状态和 `current_task_id` 对应的真实 Task 状态；成功导包后保留该 Task 引用，避免把已成功、失败或取消误显示成“Prompt 已就绪”。首次执行由 SQLite 发布协调器在同一短事务中完成 Task 入队和请求关联；通用手工重试也在同一事务把关联从失败 Task 切换到新 Task，并对幂等或并发结果复核精确 `taskType + canonical payload` 与聚合当前引用，避免 Worker 抢跑、页面继续观察旧任务或返回另一工作流的 Task。当请求已完成、全部候选均被拒绝且 Bundle 少于 5 版时，发布事务以 revision CAS 原子恢复为 `ready` 并关联新 Task；存在 accepted/needs_review 候选、版本已满或正在导包时拒绝重新执行。

## 6. 安全与失败

- Brief 不包含完整画像，仅包含用户填写的目标岗位等非身份字段。
- 外部 Agent 工作目录不是仓库或 data root，沙箱固定 read-only。
- 受限浏览器使用无登录态临时 Profile，不提供交互或任意脚本能力；域名、重定向、页数、字节和时间均有硬限制。
- 页面正文与外部 Agent 输出一样作为不可信数据；Codex 没有可被页面内容触发或扩大的浏览器、网络或本机工具。
- 取消、超时或退出必须关闭 Codex、工具服务和浏览器的完整进程树并清理临时 Profile。
- 外部文本以 React 文本节点展示，链接验证后使用 `noopener noreferrer`。
- 失败任务不删除旧 Prompt/Schema；无效 Bundle 不改变当前候选。
- 自动来源首版统一 `unverified`，人工接受不把它提升为已核验。

## 7. 测试映射

| 测试层             | 覆盖                                                                        |
| ------------------ | --------------------------------------------------------------------------- |
| Domain/Application | Brief/Bundle Schema、指纹、URL、去重、导入 CAS、审核和状态机                |
| DB 集成            | 迁移、Task 原子发布/重绑、取消门控、候选替换、accepted 保护                 |
| Worker             | 伪执行器成功/失败/取消/超限、统一导入路径与并发键                           |
| 浏览器基础设施     | 确定性采集、工具白名单、URL/SSRF/重定向、Prompt injection、限量与全路径清理 |
| Web/浏览器         | 请求创建、导出、执行、手工导入、轮询、审核、网友列表和窄屏                  |

定向来源覆盖增量在普通 CI 中增加五组固定回归：允许域名优先组在通用组之前耗尽、提供方结果过滤后再决定回退、跟踪参数变体 identity 去重且保留最终 URL、页面质量正反样本、可信公网 pin 与全 `198.18/15` 透明转译/混合答案拒绝。另设显式联网覆盖测试，以 `allowedDomains = ["nowcoder.com"]` 和“大模型算法 / 大模型应用开发”为 Brief，在匿名公开访问条件下要求至少 4 个不同 source identity 且每个岗位方向至少 2 个；该测试失败时输出候选数和有界拒绝分类，不降低门槛或改用夹具冒充真实覆盖。
