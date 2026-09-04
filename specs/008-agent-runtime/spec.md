# 008 轻量 Agent 运行时规格

> 状态：Implemented
> 依赖：001, 002, 003

## 目标

提供最小、透明、可版本、可预算、可测试的模型与工具运行能力，支撑画像、职位理解和建议 Agent。

## 非目标

- 不实现通用多 Agent 图编排、长期记忆或自治任务规划。
- 不允许 Agent 直接写数据库或任意访问网络/文件。
- 不绑定单一模型供应商。

## 功能需求

- **AGT-001**：ModelClient 必须支持结构化请求、超时、AbortSignal、用量和标准错误分类。
- **AGT-002**：AgentDefinition 必须声明 key、Agent/Prompt 版本、输入输出 Schema、工具和预算。
- **AGT-003**：运行前必须校验并最小化输入，计算完整 cacheKey；只有成功且版本一致的运行可命中。失败/取消运行不得阻止相同 cacheKey 创建重试运行，并发成功必须收敛到一个缓存结果。
- **AGT-004**：输出必须通过 Zod；失败时最多执行一次受限修复，仍失败则保存 failed。
- **AGT-005**：Runner 必须强制 timeout、maxSteps、输入/输出 Token 与估算成本上限。
- **AGT-006**：工具必须白名单注册、输入输出校验、默认只读并记录脱敏调用摘要。
- **AGT-007**：每次运行必须记录模型配置哈希、输入哈希、状态、耗时、Token、估算成本、货币/定价版本和错误分类。
- **AGT-008**：Prompt 变更必须提升版本；Schema 变更必须有版本和重算策略。
- **AGT-009**：模型限流/临时错误可交给 Worker 重试；无效配置、预算超限和持续无效输出不得自动循环。
- **AGT-010**：每个业务 Agent 启用前必须有脱敏黄金集和可重复评测报告。
- **AGT-011**：首个线上 Provider 必须支持 OpenAI 兼容的 Chat Completions JSON 接口；本地开发可从 `.env` 的 `BASE_URL`、`API_KEY`、`MODEL` 读取配置，同时保留 `JOBHUNTER_MODEL_*` 作为项目规范化环境变量，规范化变量优先。
- **AGT-012**：线上 Provider 必须支持 Anthropic Messages JSON 接口，通过 `model.provider=anthropic` 选择；原生请求、工具调用、结构化输出、用量与错误必须转换为项目自有 DTO，且不得暴露 API Key。
- **AGT-013**：DeepSeek Chat Completions 必须优先使用其支持的 `json_object` 模式；模型返回代码围栏 JSON、空正文或非 JSON 正文时，适配器必须先执行有界规范化，仍无法解析则交给 Runner 的唯一一次结构化修复，禁止在适配器与 Runner 之间形成无限重试。

## 质量与安全需求

- **AGT-Q01**：Agent Runner 不依赖职位或简历具体业务类型。
- **AGT-Q02**：日志不得包含 API Key、完整 Prompt 输入、完整简历或工具敏感输出。
- **AGT-Q03**：FakeModelClient 必须支持普通测试完全离线运行。
- **AGT-Q04**：模型不可用不影响同步、查询和确定性匹配。

## 验收场景

1. 相同版本与输入第二次运行命中缓存，不调用模型。（AGT-003）
2. Prompt 或模型配置变化导致新 cacheKey。（AGT-003,008）
3. 相同 cacheKey 首次失败后可创建第二次运行并成功；失败记录保留且成功结果成为唯一缓存。（AGT-003）
4. 首次输出 Schema 无效、修复成功时保存修复后的有效结果且只修复一次。（AGT-004）
5. 工具循环超过 maxSteps 被终止为 budget_exceeded。（AGT-005）
6. 工具请求未注册能力时被拒绝，不执行副作用。（AGT-006）
7. 模型返回 rate limit，运行失败分类正确且 Worker 按策略重试。（AGT-009）
8. 日志敏感扫描未发现输入正文或密钥。（AGT-Q02）
9. 显式在线烟测可以使用本地 `.env` 发起最小结构化请求；普通测试和 CI 不读取真实密钥、不产生付费调用。（AGT-001,011, AGT-Q02）
10. 配置 Anthropic Provider 后，Worker 与 CLI 使用 Messages API 完成结构化输出和工具调用；OpenAI 兼容配置行为不变。（AGT-001,012, AGT-Q02, AGT-Q04）
11. DeepSeek 首次请求直接使用 `json_object`；代码围栏 JSON 可在本地规范化，普通文本或空正文触发一次无工具修复，第二次仍非法时保存 `invalid_output`。（AGT-004,009,013）

## 未解决问题

无。首个模型供应商由运行配置选择；开发与 CI 使用 FakeModelClient。
