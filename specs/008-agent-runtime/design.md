# 008 轻量 Agent 运行时设计

> 状态：Implemented

AgentDefinition.validateOutput 在 Schema 校验后执行，业务拒绝使用 invalid_output 分类并给出安全纠正摘要；Runner 在 completeSucceeded 前执行它。缓存校验失败通过条件更新失效，不删除审计；并发胜者也重新校验。所有输出错误共享现有单次修复调用，不增加独立重试循环。

实现遵循 [Agent 与匹配设计](../../docs/arch/agent-and-matching.md)。

模型价格由统一配置提供，支持 USD 和 CNY 两种货币，价格单位为每百万 Token。适配器在收到供应商 usage 后换算为对应货币的微单位；没有完整价格配置时保留 token 用量，但将成本记为 `null`，避免把未知价格误判为免费。

默认价格策略参考 CC-Switch：先将模型 ID 去掉路由前缀、冒号后缀、日期后缀并转小写，再查随版本发布的内置官方美元种子价格表，覆盖 OpenAI、Anthropic、DeepSeek、Kimi、MiniMax、GLM 和 Qwen 等常用模型；`MODEL_COST_CURRENCY` 选择 `USD` 或 `CNY`，价格覆盖变量按所选货币解释。内置表未命中时不猜测价格，记录 `unpriced`。

GLM-5.3、GLM-5.3-Flash 和 GLM-5.3-FlashX 的内置值采用 Z.ai 海外 API 的美元目录。通过 `MODEL_COST_CURRENCY=CNY` 可将覆盖价格解释为人民币；Web 诊断页面用一个全局 USD/CNY 切换统一展示所有记录，并按 `MODEL_USD_TO_CNY_RATE` 换算，不在同一列表中混排不同币种。

简历画像提取使用 `resume-profile` Prompt v3，按通用规则、教育经历、工作经历、项目经历、技能与领域、证据与输出检查分块组织要求。日期由模型直接补全为 `YYYY-MM-DD`：只有年月时起始补为月初、终止补为月末；只有年份时起始补为 `09-01`、终止补为 `06-30`；季节按固定季节边界补全。应用层不通过脚本改写模型日期。

Agent 行为版本统一使用三段式 SemVer（例如 `1.0.0`、`2.1.0`）。`defineAgent` 在组合根装配前拒绝 `v1`、`1` 或其他非三段式值。版本号是缓存键和运行审计的一部分，任何变更都必须先取得产品负责人明确同意；实现变更不得自行递增版本。历史数据采用破坏性迁移直接归一化为对应三段式值。

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

首个 Provider 使用 OpenAI 兼容的 `POST {baseUrl}/chat/completions` 边界，不向 Agent Core 暴露供应商 DTO。配置在组合根归一化，只接受 `.env` 的 `BASE_URL`、`API_KEY`、`MODEL`；`BASE_URL` 缺省为 `https://api.openai.com/v1`。API Key 仅保存在 `SecretString` 和请求头中，Provider metadata、异常与日志不得包含密钥。在线烟测通过显式脚本执行，不进入默认测试集合。

DeepSeek 的 Chat Completions 直接以 `json_object` 发起结构化请求，避免先发送该端点不支持的 `json_schema`。其他 OpenAI 兼容端点仍优先协商 `json_schema`，400 时依次回退到 `json_object` 和无格式参数。响应正文先尝试严格 JSON，再仅剥离包裹整个正文的单层 `json` 代码围栏；仍无法解析或正文为空时以 `unparsed_output` 交给 Runner，不持久化或记录原文。Runner 将其视为首次 Schema 失败并消耗唯一一次无工具修复；修复响应仍未解析或不满足 Schema 时以 `invalid_output` 结束。

Anthropic Provider 使用原生 `POST {baseUrl}/v1/messages` 边界和 `2023-06-01` API 版本，通过顶层 `system`、`output_config.format`、`tools[].input_schema` 及响应 `content` block 转换项目 DTO。为兼容尚未支持结构化输出的模型或网关，仅在 `output_config` 返回 400 时重试不带该字段的请求。组合根根据标准化 `BASE_URL` 自动创建客户端：主机名标签或路径段存在独立 `anthropic` 时使用 Anthropic，其余地址使用 OpenAI 兼容协议；无法从无标识的通用代理地址判断协议，因此 Anthropic 代理地址必须保留 `anthropic` 主机标签或路径段。

## Runner

Runner 自身不写业务表，只通过 AgentRunStore 保存运行和工具摘要。业务 Handler 在 Runner 返回后关联 ProfileVersion、JobEnrichment 或独立 MatchAdvice，不能把建议直接写回 MatchResult。

AgentRunStore 允许同一 cacheKey 存在多个失败/取消运行，只对 succeeded 建立部分唯一约束。创建运行前先查成功缓存；并发提交成功发生唯一冲突时，当前运行读取胜出的成功记录并以 cache-race-resolved 结束，不覆盖对方结果。

工具循环每一步先验证预算和取消，再验证工具名/input，执行只读工具并验证 output。结构化修复使用独立、固定提示且不允许工具；无效 JSON 与 Schema 不匹配共享同一个修复预算，不能各自重试一次。

## Prompt Registry

Prompt 以 `packages/*/prompts/<agent>/<version>.ts` 存储，导出文本与输出 Schema version。启动测试验证 key/version 唯一。

## 评测

当前不维护提交到版本库的评测案例或发布基线；已停用的历史案例与摘要移入不提交的 `var/archive/retired-samples-20261023/`。未来如恢复评测，报告输出到不提交的 `var/evals`，不在 `docs/evals` 保留历史基线。评测不默认在普通测试中调用付费模型。报告必须区分供应商调用失败、Schema 失败和事实质量失败，不能用“只统计成功样本”提高通过率。

## 隐私

Canonical input hash 在进程内从完整最小输入计算；持久化只保存哈希和已校验输出。若业务必须保留输出，输出 Schema 必须排除联系方式等不必要字段。
