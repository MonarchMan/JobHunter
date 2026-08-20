# Agent、画像与匹配设计

> 状态：Accepted
> 版本：1.1.0
> 日期：2026-08-19

## 1. 边界

Agent 负责语义提取与建议，不负责官网同步正确性、职位生命周期、硬性数据校验或最终持久化事务。匹配系统先产生确定性结果，再由 Agent 补充解释；模型失败不会阻止已有职位的查询和基础排序。

首期 Agent：

- `resume-profile`：简历文本 → 结构化画像候选版本。
- `job-understanding`：职位修订 → 结构化语义标签。
- `job-advice`：确定性匹配结果 + 证据 → 建议与解释。

## 2. Agent 运行协议

```ts
interface AgentDefinition<TInput, TOutput> {
  key: string;
  version: string;
  promptVersion: string;
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
3. 命中成功缓存则返回已有结果。
4. 创建 `agent_runs.running`。
5. 调用模型，必要时执行白名单只读工具。
6. 校验输出；最多执行一次结构化修复。
7. 成功则保存已校验 JSON，失败则保存分类和脱敏摘要。
8. 应用层在独立短事务中把结果关联到画像、职位语义或独立的匹配建议记录。

缓存键：

```text
sha256(agentKey | agentVersion | promptVersion | modelConfigHash | canonicalInputHash)
```

模型供应商、模型名、温度、结构化输出模式和推理强度都属于 `modelConfigHash`。仅 `succeeded` 运行可命中缓存；失败运行保留审计但不得占用成功缓存唯一性，重试会创建新的 AgentRun。若两个相同运行并发成功，数据库部分唯一索引选出唯一缓存结果，另一个运行转为读取该结果而不是覆盖。

## 3. Prompt 与 Schema 版本

- Prompt 存在代码库中，不存数据库作为可随意编辑的正文。
- Prompt 修改必须提升 `promptVersion`。
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

匹配分两步：资格判断和加权评分。若评分使用 `job-understanding` 结果，MatchResult 必须显式引用该不可变 JobEnrichment；没有语义结果时引用“无 enrichment”哨兵语义。模型或 Prompt 升级生成新的 enrichment 后，必须产生新的匹配输入哈希，不能覆盖旧结果。

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

`job-advice` 只能使用已提供的职位修订、有效画像、确定性分项和证据，输出：

- 匹配亮点。
- 明确缺口与不确定项。
- 简历中可强调但不得虚构的经历。
- 面试或学习准备建议。
- 一段简短总评。

Agent 建议保存为独立、版本化 MatchAdvice，不修改 MatchResult 或 `total_score`。失败运行不创建 MatchAdvice，确定性结果仍可展示和重试。若需要未来引入语义分数，应作为显式 JobEnrichment 输入和规则集维度，并通过 ADR 与离线评测后启用。

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
