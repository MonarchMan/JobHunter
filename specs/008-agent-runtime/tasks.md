# 008 轻量 Agent 运行时任务

- [x] 实现 Agent 原记录重试、累计成本和工具序号续接，验证失败到成功与输入隔离。

- [x] **AGT-T015** 实现客户端级结构化输出协商记忆，消除逐请求 400 试探重复调用；网络类临时失败摘要附带脱敏原因代码。（AGT-017, AGT-018, AGT-Q02）

2026-11-04 验证：LiteLLM 网关对 `json_schema` 返回 400，原实现每次请求都先探测 `json_schema` 再回退 `json_object`，导致每个 Agent 运行出现两次 API 请求。OpenAI 兼容与 Anthropic 客户端现在按实例记忆协商成功的格式；连接失败摘要从 `Model provider request failed.` 增强为带 `ECONNREFUSED` 等原因代码，仍通过既有脱敏截断。新增 3 项单元测试（协商复用 ×2、网络原因代码）。

- [x] 增加旧型号 cc-switch USD 白名单兜底，保持国内官网报价优先，验证币种、显式覆盖和缺失字段。

- [x] 核验 cc-switch 最新版与国内官方报价，统一国内缓存价格目录、时长明细、环境配置和上下文阶梯，覆盖币种隔离、覆盖优先级、缺失值和端到端计费测试；海外报价不扩展。

- [x] 实现缓存明细归一化、逐请求分项计价、DeepSeek 忙闲映射、持久化与详情展示，并覆盖零值、缺失、边界、累计和迁移测试。

- [x] 核验 DeepSeek 官方计价规则，提供条件保护的历史成本回填端口，备份后回填指定未定价记录并验证其他字段不变。

> 状态：Implemented

- [x] **AGT-T012** 增加成功提交前业务校验、坏缓存失效与共享修复预算测试。（AGT-004,009）
- [x] **AGT-T013** 统一 Agent 行为版本为三段式 SemVer，拒绝非标准格式，并按 Agent 键迁移现有运行记录。（AGT-014）
- [x] **AGT-T014** 按标准化模型 ID 查询内置价格，支持显式单价覆盖并将未知成本保留为 `null`。（AGT-015, AGT-016）

> 显式覆盖：AGT-001, AGT-002, AGT-003, AGT-004, AGT-005, AGT-006, AGT-007, AGT-008, AGT-009, AGT-010, AGT-011, AGT-012, AGT-013, AGT-014, AGT-015, AGT-016, AGT-Q01, AGT-Q02, AGT-Q03, AGT-Q04

- [x] **AGT-T001** 定义 ModelClient DTO、错误分类、FakeModelClient 和契约测试。（AGT-001, AGT-Q03）
- [x] **AGT-T002** 实现 AgentDefinition、ToolDefinition、Registry 与唯一性校验。（AGT-002,006）
- [x] **AGT-T003** 实现规范输入哈希、cacheKey、成功部分唯一索引、失败后重试和并发成功收敛测试。（AGT-003,008）
- [x] **AGT-T004** 实现 AgentRunner 的结构化输出、一次修复、取消和错误映射。（AGT-004,009）
- [x] **AGT-T005** 实现 step/token/time/cost 预算与边界测试。（AGT-005）
- [x] **AGT-T006** 实现 AgentRunStore、成本货币/定价版本、ToolCall 摘要和敏感日志测试。（AGT-006,007, AGT-Q02）
- [x] **AGT-T007** 实现 Prompt Registry 和版本一致性测试。（AGT-008）
- [x] **AGT-T008** 建立通用 eval runner、黄金集格式和报告 Schema。（AGT-010）
- [x] **AGT-T009** 接入首个可配置 ModelClient provider，并验证无配置时确定性功能可启动。（AGT-Q04）
  - 2026-08-20：Provider Registry 与无 Provider 启动能力已完成；具体线上 Provider 待按官方 API 文档复核请求/工具调用结构后接入。
  - 接入 OpenAI 兼容 Chat Completions Provider，支持本地 `.env` 别名、结构化输出、工具调用、错误分类和显式在线烟测。（AGT-001,011, AGT-Q02）
- [x] **AGT-T010** 接入 Anthropic Messages Provider，并让 Worker/CLI 按 provider 装配客户端；覆盖结构化输出、工具调用、错误分类、配置别名和 OpenAI 回归测试。（AGT-001,012, AGT-Q02, AGT-Q04）
  - 2026-10-13：移除显式 Provider 与供应商专用环境变量，统一使用 `BASE_URL`、`API_KEY`、`MODEL`，并按 URL 主机标签或路径段自动选择协议。（AGT-011,012）
- [x] **AGT-T011** 为 DeepSeek 接入 `json_object` 优先协商、代码围栏规范化和非 JSON/空正文单次 Runner 修复链路。（AGT-004,009,013, AGT-Q02）
