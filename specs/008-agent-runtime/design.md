# 008 轻量 Agent 运行时设计

重试使用 AgentRunStore.restartFailed 事务恢复失败或取消记录，Runner 继续使用原 ID，旧用量与本次用量在结束时合并，预算仍针对本次尝试。任务作用域进入缓存键，禁用成功缓存的任务仍可通过该作用域恢复失败记录。工具序号从历史最大值之后开始；版本、模型或输入改变时新建独立运行。

## 国内供应商价格目录

旧型号例外：MiniMax M2/M2.1/M2.5/M2.7 及明确列出的加速型号，Kimi K2-0905/Thinking/Turbo/K2.5，在国内官方入口使用 cc-switch `8be8405` 的美元参考价。该白名单不含已有国内报价的 K2.6/K2.7 Code、K3、M3、GLM、Qwen。无显式币种时白名单默认 USD，其他国内模型仍默认 CNY；显式 CNY 不将美元数值直接标成人民币，必须提供自定义价。参考价版本带 `cc-switch-8be8405-usd-reference`，详情页标注旧型号参考价。未知型号、代理与套餐入口不启用此兜底。

本次范围仅为国内按量 API。参考 cc-switch 上游提交 `8be840557bacd89d592f13ddc1bee0586afaea14` 的 parser/calculator 分层与缓存包含关系；缺失值保留 null，不沿用固定汇率折算。海外基础输入/输出估算目录保持既有行为，放在 legacy-pricing.ts，不新增海外缓存报价。

国内目录按入口、币种、模型 ID 和用量选价；国内官网报价在未显式指定 MODEL_COST_CURRENCY 时默认为 CNY，旧型号美元白名单默认为 USD，显式设置优先。除此前已实现的 DeepSeek 双币报价外，国内人民币报价不转换成美元计价。列表的货币展示转换与实际报价币种是两个独立环节。自定义输入输出价格不混入官网缓存价，三项缓存覆盖变量分别为 MODEL_CACHE_READ_COST_PER_MILLION、MODEL_CACHE_WRITE_COST_PER_MILLION、MODEL_CACHE_WRITE_1H_COST_PER_MILLION。

通用协议仍支持 OpenAI 兼容和 Anthropic 兼容接口，国内 Kimi/MiniMax 等同样使用它们。新增 5 分钟和 1 小时写入用量及价格快照使用现有 JSON 列保存，无需改动旧记录。Kimi Chat 的时长从 Msh-Usage-Cache-Write-Tokens-5m / -1h 响应头读取；Messages 从 cache_creation 读取。缺失时长不默认为 5 分钟。显式零不能被低优先级字段覆盖。

### 2026-11-01 国内报价核验

| 来源 | 接入规则与范围 |
| --- | --- |
| [cc-switch 用量解析](https://github.com/farion1231/cc-switch/blob/8be840557bacd89d592f13ddc1bee0586afaea14/src-tauri/src/proxy/usage/parser.rs) | 参考缓存语义与分项计算。其海外价格和固定汇率折算不作为国内报价。 |
| [DeepSeek 中文价目表](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/) | 保留 Flash/Pro 的忙闲映射及官方原生币种报价，按每次请求时刻定价。 |
| [智谱 API 价格](https://docs.bigmodel.cn/cn/guide/start/pricing) | 国内 CNY；GLM-5.3、Flash、FlashX、5.2、4-Plus 等固定价，GLM-5/5.1 按输入分档，GLM-4.7 还按输出分档，缓存存储当前免费。 |
| [Kimi 国内首页](https://platform.kimi.com/)、[K2.6/2.7 国内价](https://platform.kimi.com/?aff=nanoinfra)、[缓存细则](https://platform.kimi.com/docs/guide/context-caching) | K3、K3.1 Pro/Highspeed、K2.6、K2.7 Code。K3 的两个 TTL 价格已确认；K3.1 Pro 的 1 小时价未在可读取国内价目中确认，保留 null，可显式覆盖。 |
| [MiniMax 国内价格](https://platform.minimax.cn/docs/pricing/overview)、[缓存语义](https://platform.minimax.cn/docs/api-reference/text-prompt-caching) | M3/M3.1-Flash 使用人民币官网价，M3 按总输入长度换档；旧 M2 系列国内完整价目前未核实，按明确白名单使用 cc-switch 美元参考价，不折算成虚构的人民币官网价。 |
| [千问 Plus](https://help.aliyun.com/zh/model-studio/qwen-plus)、[Max](https://help.aliyun.com/zh/model-studio/qwen-max)、[缓存规则](https://help.aliyun.com/zh/model-studio/context-cache)、[模型价格](https://help.aliyun.com/en/model-studio/model-pricing) | 北京 CNY 隐式缓存；Plus 按输入长度分档，思考模式依响应 reasoning_tokens 区分，缺失时输出单价未知；Turbo 缓存折扣未确认时不设缓存价。 |

仅自动计算本应用的同步文本按量调用；套餐入口、非标准 service_tier、未核验地域或模型保留未知。旧 moonshot-v1、模糊 kimi-k2 等白名单外的未知型号仍需要显式配置。价格版本是本次核验快照，不回算历史金额。未知缓存可以给出含假设的估算，但缓存写入可能更贵，因此不声称是上界。

common 契约定义请求计费明细 Schema，模型适配器归一化缓存语义并调用纯计价函数，Runner 汇总并通过仓储在完成事务中写入新增 nullable model_usage_json。详情页按请求展示时间、模型、输入输出 Token 与合计费用，缓存分项仅保存不逐列展示。参考 cc-switch 的 parser/calculator 分层，使用定点十进制运算；DeepSeek 官方输入命中字段优先，其他兼容接口使用标准缓存字段。官方忙闲价仅在无显式价格覆盖时启用；CNY 使用官网人民币价，不通过汇率反推。当前日历覆盖 2026 年，未知年份仅在可确定的周末或非忙时计价，潜在忙时返回未知。Schema 迁移仅新增可空字段，旧记录金额保持不变，不推测补齐历史缓存量。

实现参考 [cc-switch 用量解析](https://github.com/farion1231/cc-switch/blob/8be8405/src-tauri/src/proxy/usage/parser.rs) 与同目录 calculator.rs；节假日日历依据 [2026 年放假通知](https://www.beijing.gov.cn/cs/gncs/zcwj/202603/t20260327_4568275.html)。缓存未知时保留 null；界面每个单元格只展示一个值，合计为空时展示“未定价”，不再逐条标注估算口径。

通过独立 AgentRunCostCorrectionStore 端口回填已完成且 unpriced、成本为空的运行。仓储用开始时间、输入输出用量作条件更新，只允许更新金额、币种与价格版本；维护前备份数据库并保存脱敏计算依据。DeepSeek Flash 2026-11-01 核验来源：https://api-docs.deepseek.com/quick_start/pricing/ 。闲时每百万 Token 美元价格：缓存命中 0.003、未命中 0.15、输出 0.6；高峰翻倍。北京时间工作日 09–12、14–18 为高峰，周末和法定节假日除外。本次历史记录全程位于闲时，未保存缓存明细，使用全部输入未命中的估算上界。

> 状态：Implemented

AgentDefinition.validateOutput 在 Schema 校验后执行，业务拒绝使用 invalid_output 分类并给出安全纠正摘要；Runner 在 completeSucceeded 前执行它。缓存校验失败通过条件更新失效，不删除审计；并发胜者也重新校验。所有输出错误共享现有单次修复调用，不增加独立重试循环。

实现遵循 [Agent 与匹配设计](../../docs/arch/agent-and-matching.md)。

模型价格由统一配置提供，支持 USD 和 CNY 两种货币，价格单位为每百万 Token。适配器在收到供应商 usage 后换算为对应货币的微单位；没有完整价格配置时保留 token 用量，但将成本记为 `null`，避免把未知价格误判为免费。

默认价格按归一化模型 ID 和供应商入口查询。国内采用上述人民币目录；海外原有基础目录本次不扩展。未知计价条件保持 null，显式价格按 MODEL_COST_CURRENCY 解释。

智谱国内 open.bigmodel.cn 使用人民币目录，海外旧规则独立保留。Web 诊断页面的 USD/CNY 展示切换按 MODEL_USD_TO_CNY_RATE 换算，不影响逐请求保存的原生报价和币种。

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
