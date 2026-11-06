# 009 职位匹配与建议设计

> 状态：Implemented

## 数据所有权

recruitment 管理 jobs 当前职位事实及观测；matching 管理 job_metadata 当前派生信息。通过公开查询契约读取职位和资料，common 不依赖业务模块。任务运行时由 common 提供，入口装配在 CLI 与 Web。

## 当前存储

job_metadata 使用独立 ID、job_id 外键、name、value、created_at、updated_at，唯一约束为 (job_id, name)。name 为 enrichment、match_result、match_advice，每类最多一份结果；覆盖时保留 ID 和首次创建时间，完全相同的结果幂等返回。删除职位级联清理 metadata。规则配置直接使用代码常量，无规则集注册表。

jobs 不再复制正文到 job_revisions，content_id 是当前内容的一次性身份，content_hash 用于比较内容变化；来源哈希和 URL 保存在 jobs。领域查询从当前列构造输入，不保存历史快照。现有任务契约中的 jobRevisionId 指向该内容身份，不是独立数据记录。

match_result 的 value 包含：

- content_id、profile_version_id、enrichment_id：生成输入。
- rules_hash、input_hash：规则和完整结果输入摘要。
- filter_status、total_score：筛选与最终分数。
- components：仅 dimension、score、max_score 的规则分项数组。
- risk_results：确认不满足的规则标识，去重。
- unknown_rules：信息不足的规则标识，去重；未设置的偏好不加入。
- model：null 或 {score, reasons}，模型原始分为 0～100，理由最多五条。

解析和建议 value 保存结果、内容摘要、Schema 与 Agent 运行引用；建议另绑定评分 input_hash。不设置软删除、公开状态或无用途的文件字段。JSON 在边界校验，排序通过 SQLite JSON 提取与表达式索引完成。

## 评分与执行

规则检查岗位、地点及明确资格、偏好条件，适用条件等权计算已确认满足比例。岗位不匹配只影响分数；明确硬条件失败才排除；未知不等于失败，无适用条件时规则分为 100。

模型独立综合所有相关维度，与规则覆盖范围允许重叠。有模型分时按规则 30%、模型 70% 合成；模型不可用时退回规则分。规则分项与模型综合判断分别存储，不重复累计。

Web 与 CLI 提交 match.score-job 用户意图任务。模型模式一次取得职位事实、匹配评价与可选建议，再汇总规则评分；任务重试保留运行诊断。成功模型结果不因重新执行而自动复用，最新成功业务结果覆盖原记录。

按 [ADR-0061](../../docs/adr/0061-staged-sync-task-with-scoring-stage.md)，自动评分在 source.sync 阶段 B 串行调用可复用逐职位评分服务；模型失败可降级，单项失败不中断其他职位，同步任务保存检查点。SyncScoringStage 由 recruitment 声明、matching 实现、apps 注入。

## 输入有效性

职位内容变化在短事务中更新事实、取消旧输入任务并删除派生结果。模型请求发生在事务外，完成后再次核对当前内容身份。评分写入确认资料仍为当前版本；建议写入确认资料、职位和评分输入摘要未变。模型分数、理由及解析内容摘要参与评分 input_hash，防止稳定 metadata ID 掩盖结果变化。

资料变化后的旧结果不能作为当前结果展示；新任务失败保留上一份成功结果。规则配置变化后，当前匹配查询只使用与当前规则摘要一致的结果。更改评分时使依赖旧评分的建议失效。

## 验收

单元测试覆盖规则边界、未知条件与分数组合；集成测试覆盖迁移、覆盖幂等、独立 ID 保留、模型理由保留、过期任务拒绝回写、级联清理和分页查询。Web 回归验证首页、职位列表、详情规则与模型评分和建议展示。

## 职位分析 Agent

match.score-job 内调用统一职位分析用例，再执行确定性评分并保存同次分析建议。输出分为 understanding、match、advice；关闭部分返回 null。事实验证原文证据，建议验证文本边界。Agent 输入包含输出开关及按开关装配的指令，固定定义确保建议查询可按同一身份校验。输出独立存储为职位元数据，共享 agent_run_id。建议不依赖最终总分，不再保留建议失败单独恢复检查点。自动评分总开关继续控制同步后是否启动分析，用户主动评分使用所选 rules/llm 模式；求职建议开关只控制同次模型输出，不再派生任务。
