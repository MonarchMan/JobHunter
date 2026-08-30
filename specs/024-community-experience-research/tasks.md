# 024 外部 Agent 网友面经研究任务

> 状态：Implemented

- [x] **COMM-T001** 实现 Research Brief/Bundle Schema、冻结 Prompt/JSON Schema、URL/引用校验与确定性去重。（COMM-001, COMM-002, COMM-005, COMM-006, COMM-007, COMM-008, COMM-Q02, COMM-Q03, COMM-Q04）
- [x] **COMM-T002** 增加 ResearchRequest 与共享面经来源/审核字段迁移、Repository 和集成测试，研究文档复用通用文件实体。（COMM-001, COMM-006, COMM-007, COMM-008, COMM-009, COMM-010, COMM-011, COMM-012, COMM-013, COMM-Q01, COMM-Q02）
- [x] **COMM-T003** 实现研究请求、人工 Bundle 导入、候选审核和网友面经查询应用用例。（COMM-001, COMM-002, COMM-005, COMM-006, COMM-007, COMM-008, COMM-009, COMM-010, COMM-011, COMM-012, COMM-013, COMM-014, COMM-Q01, COMM-Q02, COMM-Q05）
- [x] **COMM-T004** 实现 ExternalResearchExecutor 端口、Codex 本地适配器、Worker Handler、取消/超时/诊断与伪执行器测试。（COMM-003, COMM-004, COMM-005, COMM-011, COMM-014, COMM-Q01, COMM-Q02, COMM-Q03, COMM-Q04）
- [x] **COMM-T005** 实现 Web 创建、导出、执行、导包、审核、状态、筛选和网友面经页面，补浏览器完整闭环。（COMM-001, COMM-002, COMM-003, COMM-004, COMM-005, COMM-006, COMM-007, COMM-008, COMM-009, COMM-010, COMM-011, COMM-012, COMM-013, COMM-014, COMM-Q02, COMM-Q05）
- [x] **COMM-T006** 运行迁移、格式、lint、类型、依赖、单元、集成、E2E、浏览器与文档门禁并更新实现状态。（COMM-001, COMM-002, COMM-003, COMM-004, COMM-005, COMM-006, COMM-007, COMM-008, COMM-009, COMM-010, COMM-011, COMM-012, COMM-013, COMM-014, COMM-Q01, COMM-Q02, COMM-Q03, COMM-Q04, COMM-Q05）
- [x] **COMM-T007** 实现 `community-research-prompt@v3`、`browser-assisted-codex@v2` 及冻结 Prompt 版本—执行器兼容性校验，旧 `@v1`/`@v2` 请求只允许兼容执行器/人工导包，不得静默改变浏览语义。（COMM-002, COMM-003, COMM-004）
- [x] **COMM-T008** 实现 Worker 持有的匿名隔离浏览器网关、固定提供方与确定性 QueryPlan、岗位词与面试词相关性硬门槛及 `search/open/readPage` 采集，包括 loopback MCP 的单次 bearer token、Host/Origin 校验、公网 URL/重定向与域名策略校验、结果轮询去重、快照后关闭来源页、读取文本清洗限长及有界调用 trace。（COMM-004, COMM-015, COMM-016, COMM-Q02, COMM-Q06）
- [x] **COMM-T009** 实现无网络 `browser-assisted-codex@v2` 与 Worker 装配，保持 Codex 内建浏览器和全部网络工具禁用、原生搜索和人工导包降级路径，并完成浏览器先关闭、临时 EvidencePack 的 stdin 分区传递、Bundle 来源与本次最终 URL 前置校验、超时/取消进程树终止、网关/BrowserContext/临时 Profile 清理、权限摘要和统一 Bundle Importer 对接。（COMM-003, COMM-004, COMM-005, COMM-011, COMM-015, COMM-016, COMM-Q01, COMM-Q03）
- [x] **COMM-T010** 补充固定 QueryPlan、伪浏览器采集、相关性拒绝、Prompt injection 与 SSRF/重定向负向样本、MCP 认证/Host/Origin/工具白名单、Codex 无浏览/网络凭据、Prompt 版本拒绝和全结果路径资源回收测试，并以无登录的真实公开网页完成显式 smoke test 及产品任务 `needs_review` 验收。（COMM-002, COMM-003, COMM-006, COMM-011, COMM-015, COMM-016, COMM-Q02, COMM-Q03, COMM-Q04, COMM-Q06）
- [x] **COMM-T011** 扩展冻结 QueryPlan：规范化 `allowedDomains`，按稳定的域名 × 岗位顺序生成 `site:<domain>` 优先组；Worker 先耗尽优先组合格候选，来源目标未满足时才搜索通用组。搜索提供方必须在跳转解包、公网 URL 和域名策略过滤后仍有结果才停止回退；补充无允许域名、查询/页面上限、过滤后回退和稳定重放测试。（COMM-001, COMM-015, COMM-017, COMM-Q07）
- [x] **COMM-T012** 实现 `source-identity@v1`，折叠 fragment、默认端口及有界的全局/牛客详情跟踪参数变体，同时保留 EvidencePack、trace 与 Bundle 的实际最终 URL；补不同内容主键与分页不得误合并的回归测试。（COMM-016, COMM-018, COMM-Q07）
- [x] **COMM-T013** 在 EvidencePack 前增加 `interview-page-quality@v1` 和有界拒绝分类/计数，覆盖登录/验证码/空壳、评论列表、最小正文、低问题密度及无问号编号技术题正样本。（COMM-015, COMM-016, COMM-019, COMM-Q02, COMM-Q07）
- [x] **COMM-T014** 运行普通 CI 与显式牛客联网覆盖验收：`allowedDomains = ["nowcoder.com"]`，大模型算法和大模型应用开发方向各取得至少 2 个、合计至少 4 个不同 source identity 的高质量公开页面；执行完整研究任务进入 `needs_review`，不自动接受候选，并据结果更新规格与架构实现状态。（COMM-008, COMM-017, COMM-018, COMM-019, COMM-020, COMM-Q04, COMM-Q05, COMM-Q06, COMM-Q07）
- [x] **COMM-T015** 固化受信任公网 IP pin 与透明网络转译边界：仅当系统 DNS 全部返回 `198.18/15` 且显式启用时用转译地址连接，安全判断仍使用有界受信任 DNS 验证的公网地址；补普通公网、全转译、混合答案、非公网字面 IP、DNS 失败与取消/超限测试。（COMM-015, COMM-021, COMM-Q06, COMM-Q08）
