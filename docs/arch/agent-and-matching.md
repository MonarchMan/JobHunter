# Agent、画像与匹配设计

> 状态：Accepted
> 版本：1.1.0
> 日期：2026-08-19

## 1. 边界

规则、Agent 和 Prompt 仅保留当前实现，取消手动版本选择，以实际内容哈希隔离执行缓存；历史记录只保存结果快照，不加载旧实现。参见 [ADR-0060](../adr/0060-content-based-execution-identity.md)，本决策优先于本文旧版治理描述。

职位分析 job-analysis 一次输出职位事实、模型匹配评价与可选建议。启用块完整性、关闭块为空及原文证据校验在 Agent 运行成功前执行；纠错与失败诊断归同一次逻辑运行。旧建议阶段检查点已移除；批次保留成功职位，失败职位重试统一分析。

Agent 负责语义提取与建议，不负责官网同步正确性、职位生命周期、硬性数据校验或最终持久化事务。匹配系统取得模型分析后汇总确定性规则与模型分，建议不依赖最终总分；模型失败不会阻止已有职位的查询和基础排序。

首期 Agent：

- `resume-profile`：简历文本 → 结构化画像候选版本。
- `job-analysis`：当前职位 + 画像事实 + 输出开关 → 职位事实、综合匹配评价、求职建议；关闭部分为 null。

## 2. Agent 运行协议

```ts
interface AgentDefinition<TInput, TOutput> {
  key: string;
  inputSchema: ZodType<TInput>;
  outputSchema: ZodType<TOutput>;
  tools: readonly ToolDefinition[];
  limits: {
    timeoutMs: number;
    maxSteps: number;
    maxInputTokens: number;
    maxOutputTokens: number;
    maxEstimatedCostMicros: number;
  };
}
```

运行顺序：

1. 输入校验与最小化。
2. 计算 `input_hash` 和完整 `cache_key`。
3. 普通 run 始终新调用；runStep 仅复用同一任务步骤与资源的成功结果。
4. 创建 `agent_runs.running`。
5. 调用模型，必要时执行白名单只读工具。
6. 校验输出；最多执行一次结构化修复。
7. 成功保留输出哈希；仅 runStep 暂存恢复 JSON，任务成功、取消、删除时清除。失败保存分类和脱敏摘要。
8. 应用层在独立短事务中把结果关联到画像、职位语义或独立的匹配建议记录。

缓存键：

```text
sha256(agentKey | definitionHash | outputSchemaVersion | modelConfigHash | inputHash | taskId | stepKey | resourceKey)
```

模型供应商、模型名、温度、结构化输出模式和推理强度都属于 `modelConfigHash`。仅 `succeeded` 运行可命中缓存；失败运行保留审计但不得占用成功缓存唯一性，同一步骤失败重试沿用原 AgentRun；新任务、输入或模型变化创建新运行。若两个相同运行并发成功，数据库部分唯一索引选出唯一缓存结果，另一个运行转为读取该结果而不是覆盖。

## 3. Prompt 与 Schema 版本

- Prompt 存在代码库中，不存数据库作为可随意编辑的正文。
- Prompt 修改自动改变 definitionHash，无需维护 Prompt 版本。
- 输出结构变化必须提升 Schema 版本，并提供旧数据读取或重算策略。
- Agent 评测样本引用 Agent、Prompt、Schema 与模型配置版本。
- Prompt 不得要求模型猜测缺失事实；所有不确定字段允许 `null` 或显式置信度。

## 4. 简历画像合并

`resume-profile` 输出只包含从简历获得的候选事实和证据片段索引。应用层将其与上一有效画像合并：

1. 新提取值写入 `extracted_json`。
2. 未锁定字段采用新提取值。
3. 锁定 JSON Pointer 保留上一版本有效值。
4. 用户偏好与简历事实分离，简历重解析不得覆盖偏好。
5. 合并结果写入不可变 `profile_versions.effective_json`。

敏感正文只在当前任务内提供；Agent 日志只记录哈希、长度和必要摘要。

## 5. 确定性匹配

当前默认规则为 v3.2：纯函数引擎从冻结职位招聘类别选择社招、校招、实习权重，资格门槛与相关性得分分离。条件树保留局部修饰、上下限与三值逻辑；技能按任选组和正向使用证据计算，实践按技能、职责和贡献计算，不按长度或数字数量加分。画像可选 matchingConstraints 保存用户确认的资格事实，分项 JSON 保存证据状态。v3.1 仅增加介绍后无标题编号职责/要求的保守恢复策略。v3.2 增加校招/实习毕业届别、月份窗口及多段教育的一致性资格判断，缺失与歧义保持未知。应用入口激活独立 v3.2 规则 ID；v1/v2/v3/v3.1 定义、计算路径与历史记录保留，不全库重算。未知维度不补分、不重新分配权重，“经验不限”只豁免年限门槛。具体政策与验收以 [009 规格](../../specs/009-job-matching/spec.md) 为准，未改变依赖方向或数据所有权。

匹配分两步：资格判断和加权评分。若评分使用 `job-analysis` 结果，MatchResult 必须显式引用该不可变 JobEnrichment；没有语义结果时引用“无 enrichment”哨兵语义。模型或 Prompt 升级生成新的 enrichment 后，必须产生新的匹配输入哈希，覆盖当前结果但保留运行诊断。

### 5.1 资格判断

每条规则返回：

```ts
type RuleOutcome = {
  ruleId: string;
  status: 'pass' | 'fail' | 'unknown';
  evidence: EvidenceRef[];
};
```

只有具有明确事实证据的 `fail` 才能形成 `excluded`；未知事实形成 `uncertain`，不能硬排除。

### 5.2 评分

首期默认维度与权重：

| 维度           | 权重 |
| -------------- | ---: |
| 核心技能       |   35 |
| 相关经历与年限 |   25 |
| 岗位方向与职级 |   15 |
| 行业/业务背景  |   10 |
| 地点与个人偏好 |   15 |

规则集配置可以修改权重，但总和必须为 100。每一维先计算 0..1，再乘权重；缺失证据不得自动计满分。总分保留两位小数并限制在 0..100。

`excluded` 职位仍可保存分项证据，但默认不进入推荐列表。`uncertain` 职位允许评分，同时在结果中显示不确定项。

## 6. Agent 建议

job-analysis 使用职位与最小画像事实一次生成 understanding、match、advice。理解和模型评分由评分模式控制；求职建议开关只控制 advice，关闭块必须为 null。规则模式且建议关闭时不调用模型。自动评分总开关仍控制同步后是否进入分析流程。

understanding 仅包含可核对原文的职位事实，match 包含综合分与理由；advice 仅保留最多一段亮点、最多一段缺口及最多五项准备行动，不包含引用 ID 或重复的不确定性字段。建议基于职位和画像独立生成，不读取最终总分。

输出在 Agent 成功提交前检查块完整性及原文证据，无效时通过同一运行进行结构纠正。职位事实、最终评分及建议分别保存为 job_metadata，各保留当前值；事实与建议共享本次 agent_run_id。正常分析只创建一条逻辑运行记录，协商、纠正和失败重试的调用诊断如实保留。成功结果不作为用户重新评分的缓存。

移除 job.enrich 和 match.advise 的独立注册与旧 Prompt。升级迁移取消未完成的旧独立任务并清理旧建议恢复参数；成功历史及账本保留。后续评分由 match.score-job、match.score-batch 或同步阶段统一编排。

## 7. 工具与安全

首期工具默认只读：读取指定职位修订、读取指定画像版本、读取确定性匹配证据、查询受限的技能同义词表。工具输入输出都通过 Zod 校验并记录脱敏摘要。

Agent 不得获得：

- 任意 SQL 或文件系统访问。
- 任意 URL 请求。
- 修改职位、画像或任务状态的能力。
- 读取 API Key、Cookie 或其他来源认证信息的能力。

## 8. 评测门槛

正式启用每个 Agent 前建立脱敏黄金集：

- 画像抽取：字段准确率、证据可定位率、臆造率。
- 职位理解：必备条件召回率、技能标签准确率。
- 建议：事实一致性、可操作性、禁止虚构通过率。

硬门槛：持久化业务结果的 Schema 有效率必须为 100%（无效输出只能使运行失败）；黄金集首次响应或一次修复后的 Schema 接受率不低于 99%；敏感信息日志泄露为 0；画像事实、职位必备条件和建议中的无证据臆造为 0。模型或 Prompt 升级必须跑同一黄金集并保存对比结果；达不到门槛时不得把新版本设为活动配置。
