# 009 职位匹配与建议设计

> 状态：Implemented

## v2 类型化规则

### 后续 v3 条件与证据引擎

v3 为独立版本，保留 v2 模块与定义；默认入口改用新 ID，不修改既有规则哈希。新增纯函数条件语言、技能证据与实践匹配模块，共用三类顶层权重及既有分项/规则结果契约，不修改 UI 或数据库表。规则模式不调用 LLM；语义增强中的技能仍需按引用原文还原否定和任选关系，不能覆盖原文明示的豁免。

先将资格语句解析为 all/any/atom 节点，原子包含字段路径和 required/preferred/waived 模式；保守处理局部修饰、数值比较与缺失。unknown 在 all/any 中按三值逻辑聚合。资格歧义不得被 skill 命中掩盖。短句数值规则支持阿拉伯和常用中文数字；原文与比较值分开保留。

技能按要求组计算覆盖：必需/优先权重 3:1，any 组取最佳一项，独立要求分别计分。否定与计划内容不作为正证据；技能栏明确自述能力最高提供 0.8 覆盖，工作/项目中的实际使用证据提供 1.0。同一技能不累加不同来源。实践取最佳一条，技能相关性占 50%、职责对象覆盖占 30%、与命中职责关联的参与/负责/交付证据占 20%；参与 0.4、明确负责 0.7、负责且有交付或验证证据 1.0，均要求职责对象匹配。没有可识别的职位职责时不假造贡献，缺失信号保留其份额并说明。此为可解释初始政策，不宣称真实排序准确率提升。

“经验不限”不再将经历设为不适用；v3 仅类别配置中的零权重维度为不适用。v2 的“不限即重分配”仅保留用于历史重放。第 5 项人工样本评测不在本次范围内；本次只增加确定性边界、来源证据、不变性与版本集成回归。

统一引擎按不可变 JobRevision.recruitmentCategory 选择三套权重；旧快照可从标题/用工类型中明确的实习、校招、社招文字回退，歧义保持 unknown，禁止读取全局同步设置。v1 算法与定义保持不变，v2 单独版本/ID，初始化与 Worker 默认启用 v2。现有 MatchResult 的 components_json 保存可选 evidenceStatus 与规则类型，不增加表或迁移旧记录；完整度由有状态的分项权重计算，v1 无该状态不伪造完整度。

资格从冻结职位原文以保守规则提取，优先项与必需项分开；无法可靠解释的相关条款保持待确认，不扩大 LLM 权限。画像 matchingConstraints 保存届别、身份、实习可用时间及细分方向；旧画像缺失该对象仍合法。技能可使用已有 enrichment，否则从版本化别名字典提取职位技能；未识别技能要求为未知，不能按候选人技能数作为分母。经历/项目评分取相关技能与岗位分类的最佳覆盖，不累加重复记录。

不读取当前日期推断身份或到岗能力，保证同一冻结输入可重放。明确“不限”的经历要求标为不适用；剩余权重按比例归一到 100。未知维度保留权重且记 0 已证实分；完整度小于 100 或资格 unknown 显示暂定，排序继续使用已证实总分，不把低证据结果归一成高分。

离线脱敏样本覆盖三类边界、缺失、优先项、重复经历和别名，输出新旧分数及错误排除率；无人工相关性标注时不宣称 Top-K 质量提升。

建议 Agent v2 使用确定性去重证据目录和 ID 输出，持久化 MatchAdvice 继续使用既有 kind/value 结构。Runner 调用定义中的纯业务校验器后才能提交成功；缓存命中同样校验。手动评分失败携带已完成评分的部分结果，队列保存至 result_json，处理器定义重试 payload 以仅恢复建议阶段；不引入新的任务状态。

实现遵循 [Agent 与匹配设计](../../docs/arch/agent-and-matching.md)。

## 模块

- `packages/matching/rules`：资格规则与证据。
- `packages/matching/scoring`：维度评分、权重和总分。
- `packages/matching/rulesets`：规则集 Schema 与 v1/v2 定义。
- `packages/matching/query`：当前结果选择和稳定排序 DTO。
- `packages/matching/prompts`：job-understanding、job-advice。
- `packages/application/matching`：单个/批量计算、重算和建议任务。

## 计算流程

Worker 的 match Handler 读取不可变输入，在事务外执行：

1. 选择匹配 JobRevision 的成功 enrichment；没有则使用标准化字段并标记语义未知。
2. 运行所有 eligibility rules。
3. 按规则版本运行 v1 五维或 v2 分型 scorer，生成 components 和 total。
4. 以 ProfileVersion、JobRevision、实际 JobEnrichmentIdOrNone 和 Ruleset 计算 inputHash，在短事务中幂等写入不可变 MatchResult。
5. eligible/uncertain 且达到建议阈值时入队 advice task；阈值默认 60，可配置，不影响分数。

JobAdviceAgent 输入只包含有效画像必要字段、职位要求、分项与证据；输出通过 Schema 后新增 MatchAdvice 并引用 AgentRun。建议失败只保留 AgentRun，不修改 MatchResult。

Web 和 CLI 统一提交 `match.score-job` 用户意图任务。规则模式直接以标准化职位字段计算；LLM 模式在同一可重试任务内顺序调用既有 JobUnderstanding、确定性匹配和 JobAdvice 能力。批量操作只是在应用边界为用户明确勾选的职位逐条入队，不引入全量扫描或后台自动触发。

## 当前结果

“当前匹配”由当前 ProfileVersion、Job 最新 Revision、活动 JobUnderstanding 配置对应的成功 enrichment（没有则 none）和 active Ruleset 共同确定，不使用可变 `is_current` 标记写入 MatchResult。查询优先 enrichment-aware 结果，不存在时回退基础结果；当前建议同样按活动 JobAdvice 配置选择成功 MatchAdvice。旧结果和旧建议按版本显式查询。

## 评测

- 单元：规则边界、未知证据、权重、稳定排序。
- 集成：批量分页、幂等、版本变化、取消和 Agent 失败。
- 离线：脱敏职位/画像黄金集评估 Top-K 相关性、硬排除误杀率、解释事实一致性。

首期发布门槛：黄金集硬排除误杀为 0；Top-10 人工相关率设基线并记录，不在无历史数据时虚设高阈值；建议事实一致性 100%。
