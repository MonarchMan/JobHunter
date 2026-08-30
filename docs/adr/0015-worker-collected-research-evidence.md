# ADR-0015：Worker 预采集证据与无网络 Agent 研究

> 状态：Accepted
> 日期：2026-08-30
> 部分取代：ADR-0014 的第 1、3、7、8、9 项

## 背景

`browser-assisted-codex@v1` 把受限 `search/open/readPage` MCP 暴露给 Codex，并依靠 Prompt 要求模型主动完成浏览。真实联网试运行表明，MCP 的 `required = true` 只保证服务可连接，不能保证模型调用工具；Codex 可以在零次工具调用时直接生成结构正确但没有访问证据的 Bundle。本地逐字回溯校验会正确拒绝这类结果，但功能因此无法稳定闭环。

网络与浏览器权限不应由模型的工具选择决定。JobHunter 已经拥有查询预算、URL 策略、SSRF 防护、匿名 BrowserContext、清洗正文与调用 trace，因此应由 Worker 确定性执行采集，Codex 只处理被冻结的证据。

## 决策

1. 新增 `browser-assisted-codex@v2` 语义，并将新请求的 Prompt 升级为 `community-research-prompt@v3`。已冻结的 `@v1`/`@v2` 请求不静默改变执行语义：它们可继续使用兼容的原生搜索执行器或人工导包，但不得选择 `browser-assisted-codex@v2`。
2. 应用层从冻结 Brief 确定性生成有界搜索词、岗位相关词和优先查询数量。`allowedDomains` 非空时，Worker 先执行并耗尽 `site:<domain>` 优先组的合格候选；只有来源目标未满足且页面预算未耗尽，才开始搜索通用组。每个查询按固定提供方顺序执行，只有搜索跳转解包、公网 URL 和 Brief 域名策略过滤后仍有非空结果时才接受当前提供方，原始 DOM 有链接但全部越界或无效时继续回退。候选按各查询排名轮询，以版本化 source identity 折叠请求 URL 和最终 URL 的已知跟踪变体，同时保留实际成功读取的最终 URL；页面必须通过岗位/面试语义相关性和有界、版本化的问题质量门槛，直至取得 Brief 来源上限或耗尽浏览器预算。没有任何合格可读页面时不启动 Codex，返回不包含页面正文的有界诊断。
3. 浏览器、URL 策略、固定公网 IP 代理、域名规则、页面/字节/时间限制和临时 Profile 继续遵守 ADR-0014。受信任 loopback MCP 可以保留为同一工具协议的测试或适配传输，但生产 `browser-assisted-codex@v2` 不把其 URL 或单次 bearer token 交给 Codex。
4. Worker 把成功读取的最终 URL、标题、抓取时间、正文哈希和清洗限长正文组成临时 EvidencePack。EvidencePack 不建立业务表、不写长期 Artifact；正文只在 Worker 内存和 Codex stdin 中短暂存在，不进入 argv、环境变量、业务日志或结果 Bundle。调用 trace 在任务结束时随网关释放。
5. Codex 仅执行原文问题提取、技术价值筛选和跨来源语义归并。它使用非交互只读沙箱，禁用原生搜索、MCP、浏览器、Shell、统一执行、Computer Use、插件、Skill、多 Agent 和其他本机或联网工具。页面内容是带明确边界的不可信数据，不能改变任务、输出 Schema 或权限。
6. Codex 只在采集完成且 BrowserContext、网关和临时 Profile 已关闭后启动。正确性不依赖模型是否调用任何工具，Codex 运行期也不存在可被间接复用的研究浏览器资源。
7. 本地执行器在统一导包前使用临时 trace 确定性校验：每个来源必须等于一次成功 `open + readPage` 的最终 URL；`question.text` 必须逐字包含在同源 `evidenceExcerpt` 中，且摘录必须存在于同页清洗正文；非空 `answerExcerpt` 也必须逐字来自同页正文。无证据内容被裁剪，裁剪后无问题则整包拒绝。
8. 自动结果仍进入现有 Bundle Importer 和人工审核流程。只持久化有限问题、答案摘录、证据摘录与来源元数据，不持久化整页正文或 EvidencePack。
9. 网络、浏览器、模型和文件操作全部发生在数据库事务外。取消、超时或任一阶段失败都必须关闭 BrowserContext、网关、Codex 进程组和临时目录，不提交候选或正式 Bundle。
10. 普通 CI 使用固定查询、伪浏览器与伪模型；显式联网 smoke test 必须证明至少一个公开页面被真实读取。产品级验收还必须证明实际任务进入“待审核”，并产生非空、逐字可回溯的问题。

## 影响

- 自动研究从“模型自主浏览”变为“确定性采集 + 模型语义处理”，联网路径可重复测试，且不再出现零工具调用导致的伪来源。
- Codex 的权限面进一步缩小；代价是 Worker 需要维护简单查询规划和证据拼装。
- EvidencePack 只作为任务内临时数据，不增加数据库表或文件版本，符合通用文件实体的精简原则。
- `browser-assisted-codex@v1` 与 `community-research-prompt@v2` 的试验数据仍可保留，但不能作为 v2 执行成功的证据。

## 实施验证

- 固定 QueryPlan、伪浏览器、岗位与面试相关性拒绝、Prompt injection、URL/SSRF/重定向、loopback MCP 认证、Codex 无网络凭据和资源回收均已有自动化覆盖。
- 无登录真实公开网页 smoke test 已确认页面被实际读取；实际产品研究任务已生成非空、可逐字回溯的问题并进入 `needs_review`，没有绕过人工审核。
- 两阶段优先/通用采集、提供方过滤后回退、`source-identity@v1`、`interview-page-quality@v1` 和 `198.18/15` 透明转译安全不变量已有确定性实现与固定样本；牛客双岗位多来源的真实联网覆盖仍待最终验收，因此不据此更新规格任务完成状态。

## 备选方案

- **继续强化 Prompt 或设置更高 reasoning effort**：仍不能确定性强制工具调用，拒绝。
- **零调用时自动重试一次**：可减少偶发失败，但仍把正确性建立在模型工具选择上，仅可作为诊断手段，不作为主流程。
- **让 Codex 直接控制用户浏览器**：权限面和登录态风险不可接受，继续拒绝。
- **持久化整页 EvidencePack**：增加第三方正文存储、版本和清理负担，首版拒绝。
