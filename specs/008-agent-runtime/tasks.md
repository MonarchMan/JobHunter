# 008 轻量 Agent 运行时任务

> 状态：Implemented
> 显式覆盖：AGT-001, AGT-002, AGT-003, AGT-004, AGT-005, AGT-006, AGT-007, AGT-008, AGT-009, AGT-010, AGT-011, AGT-012, AGT-Q01, AGT-Q02, AGT-Q03, AGT-Q04

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
