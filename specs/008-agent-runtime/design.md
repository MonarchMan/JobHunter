# 008 轻量 Agent 运行时设计

> 状态：Implemented

AgentDefinition.validateOutput 在 Schema 校验后执行，业务拒绝使用 invalid_output 分类并给出安全纠正摘要；Runner 在 completeSucceeded 前执行它。缓存校验失败通过条件更新失效，不删除审计；并发胜者也重新校验。所有输出错误共享现有单次修复调用，不增加独立重试循环。

实现遵循 [Agent 与匹配设计](../../docs/arch/agent-and-matching.md)。

## 包

```text
packages/agent-core/
├─ definition.ts
├─ runner.ts
├─ tools.ts
├─ budgets.ts
├─ errors.ts
└─ index.ts

packages/llm/
├─ model-client.ts
├─ provider-registry.ts
├─ fake-model-client.ts
└─ providers/
```

ModelClient 使用项目自有 DTO，不向上暴露供应商 SDK 类型。Provider adapter 将供应商错误映射为 `rate_limited`、`temporary`、`invalid_auth`、`invalid_request`、`content_rejected`、`cancelled`。

首个 Provider 使用 OpenAI 兼容的 `POST {baseUrl}/chat/completions` 边界，不向 Agent Core 暴露供应商 DTO。配置在组合根归一化：`JOBHUNTER_MODEL_BASE_URL`、`JOBHUNTER_MODEL_API_KEY`、`JOBHUNTER_MODEL_NAME` 优先，个人本地 `.env` 可使用 `BASE_URL`、`API_KEY`、`MODEL` 别名。API Key 仅保存在 `SecretString` 和请求头中，Provider metadata、异常与日志不得包含密钥。在线烟测通过显式脚本执行，不进入默认测试集合。

DeepSeek 的 Chat Completions 直接以 `json_object` 发起结构化请求，避免先发送该端点不支持的 `json_schema`。其他 OpenAI 兼容端点仍优先协商 `json_schema`，400 时依次回退到 `json_object` 和无格式参数。响应正文先尝试严格 JSON，再仅剥离包裹整个正文的单层 `json` 代码围栏；仍无法解析或正文为空时以 `unparsed_output` 交给 Runner，不持久化或记录原文。Runner 将其视为首次 Schema 失败并消耗唯一一次无工具修复；修复响应仍未解析或不满足 Schema 时以 `invalid_output` 结束。

Anthropic Provider 使用原生 `POST {baseUrl}/v1/messages` 边界和 `2023-06-01` API 版本，通过顶层 `system`、`output_config.format`、`tools[].input_schema` 及响应 `content` block 转换项目 DTO。为兼容尚未支持结构化输出的模型或网关，仅在 `output_config` 返回 400 时重试不带该字段的请求。组合根必须根据 `model.provider` 创建客户端；`ANTHROPIC_API_KEY`、`ANTHROPIC_BASE_URL`、`ANTHROPIC_MODEL` 可作为个人本地别名，官方 Base URL 缺省为 `https://api.anthropic.com`。

## Runner

Runner 自身不写业务表，只通过 AgentRunStore 保存运行和工具摘要。业务 Handler 在 Runner 返回后关联 ProfileVersion、JobEnrichment 或独立 MatchAdvice，不能把建议直接写回 MatchResult。

AgentRunStore 允许同一 cacheKey 存在多个失败/取消运行，只对 succeeded 建立部分唯一约束。创建运行前先查成功缓存；并发提交成功发生唯一冲突时，当前运行读取胜出的成功记录并以 cache-race-resolved 结束，不覆盖对方结果。

工具循环每一步先验证预算和取消，再验证工具名/input，执行只读工具并验证 output。结构化修复使用独立、固定提示且不允许工具；无效 JSON 与 Schema 不匹配共享同一个修复预算，不能各自重试一次。

## Prompt Registry

Prompt 以 `packages/*/prompts/<agent>/<version>.ts` 存储，导出文本与输出 Schema version。启动测试验证 key/version 唯一。

## 评测

`evals/<agent>/cases/*.json` 保存脱敏输入引用和期望断言；报告输出到不提交的 `var/evals`，发布基线摘要可提交 `docs/evals`。评测不默认在普通测试中调用付费模型。报告必须区分供应商调用失败、Schema 失败和事实质量失败，不能用“只统计成功样本”提高通过率。

## 隐私

Canonical input hash 在进程内从完整最小输入计算；持久化只保存哈希和已校验输出。若业务必须保留输出，输出 Schema 必须排除联系方式等不必要字段。
