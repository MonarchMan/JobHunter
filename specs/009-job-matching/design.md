# 009 职位匹配与建议设计

> 状态：Implemented

实现遵循 [Agent 与匹配设计](../../docs/arch/agent-and-matching.md)。

## 模块

- `packages/matching/rules`：资格规则与证据。
- `packages/matching/scoring`：维度评分、权重和总分。
- `packages/matching/rulesets`：规则集 Schema 与 v1 定义。
- `packages/matching/query`：当前结果选择和稳定排序 DTO。
- `packages/matching/prompts`：job-understanding、job-advice。
- `packages/application/matching`：单个/批量计算、重算和建议任务。

## 计算流程

Worker 的 match Handler 读取不可变输入，在事务外执行：

1. 选择匹配 JobRevision 的成功 enrichment；没有则使用标准化字段并标记语义未知。
2. 运行所有 eligibility rules。
3. 运行五维 scorer，生成 components 和 total。
4. 以 ProfileVersion、JobRevision、实际 JobEnrichmentIdOrNone 和 Ruleset 计算 inputHash，在短事务中幂等写入不可变 MatchResult。
5. eligible/uncertain 且达到建议阈值时入队 advice task；阈值默认 60，可配置，不影响分数。

JobAdviceAgent 输入只包含有效画像必要字段、职位要求、分项与证据；输出通过 Schema 后新增 MatchAdvice 并引用 AgentRun。建议失败只保留 AgentRun，不修改 MatchResult。

## 当前结果

“当前匹配”由当前 ProfileVersion、Job 最新 Revision、活动 JobUnderstanding 配置对应的成功 enrichment（没有则 none）和 active Ruleset 共同确定，不使用可变 `is_current` 标记写入 MatchResult。查询优先 enrichment-aware 结果，不存在时回退基础结果；当前建议同样按活动 JobAdvice 配置选择成功 MatchAdvice。旧结果和旧建议按版本显式查询。

## 评测

- 单元：规则边界、未知证据、权重、稳定排序。
- 集成：批量分页、幂等、版本变化、取消和 Agent 失败。
- 离线：脱敏职位/画像黄金集评估 Top-K 相关性、硬排除误杀率、解释事实一致性。

首期发布门槛：黄金集硬排除误杀为 0；Top-10 人工相关率设基线并记录，不在无历史数据时虚设高阈值；建议事实一致性 100%。
