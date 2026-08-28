# 001 核心领域模型规格

> 状态：Implemented
> 依赖：无

## 目标

定义与基础设施无关的公司、来源、职位、同步、画像、匹配和任务领域语言，使所有入口与适配器共享相同状态和不变量。

## 非目标

- 不定义 SQLite 表或 HTTP 请求。
- 不实现具体公司、模型供应商、CLI 或 Web。
- 不对来源不具备的字段进行猜测补全。

## 功能需求

- **DOM-001**：系统必须使用稳定 ID 区分 Company、JobSource、Job、JobRevision、CandidateProfile、ProfileVersion、MatchResult、Task 和运行记录。
- **DOM-002**：同一来源的职位身份必须由 `(sourceId, externalJobId)` 唯一确定；无来源稳定 ID 时，适配器必须生成可重放指纹。
- **DOM-003**：职位状态只能是 `active`、`stale`、`closed`，并按总体架构状态机转换。
- **DOM-004**：标准化内容未变化时不得产生新 JobRevision；变化时必须保留不可变快照和差异。
- **DOM-005**：只有完整同步中的缺失才能增加 `missingCount`；部分或未知覆盖同步不得使职位失效。
- **DOM-006**：已关闭职位重新被可靠观察时必须恢复为 `active` 并产生状态事件。
- **DOM-007**：画像版本必须不可变；人工锁定路径在重新提取时必须保留有效值。
- **DOM-008**：匹配结果必须引用确定的 ProfileVersion、JobRevision、实际使用的 JobEnrichment（或无 enrichment 哨兵）和 RulesetVersion；Agent 建议必须独立版本化，不能覆盖确定性结果。
- **DOM-009**：领域错误必须使用稳定错误码，不暴露基础设施异常文本。
- **DOM-010**：所有领域时间由 Clock 端口提供，所有 ID 由 IdGenerator 端口提供，以支持确定性测试。

## 质量需求

- **DOM-Q01**：领域包不得导入 Drizzle、SQLite、Playwright、模型 SDK、CLI 或 Web 框架。
- **DOM-Q02**：所有状态机、值对象和规则必须可在无网络、无文件、无数据库环境下测试。
- **DOM-Q03**：标准化对象必须能稳定规范序列化，相同语义输入产生相同内容哈希。

## 验收场景

1. **DOM-A01 / DOM-002,004**：给定同一来源 ID 和相同标准化内容，重复合并时返回“无变化”，职位 ID 不变且不创建修订意图。
2. **DOM-A02 / DOM-004**：给定标题或 JD 变化，合并结果包含递增修订号和字段差异。
3. **DOM-A03 / DOM-005**：给定 coverage=`partial` 且职位未观察，状态与缺失计数保持不变。
4. **DOM-A04 / DOM-003,005**：给定连续完整同步缺失达到 stale 和 closed 阈值，状态依次转换并带原因码。
5. **DOM-A05 / DOM-006**：给定 closed 职位再次出现，状态恢复 active、缺失计数清零。
6. **DOM-A06 / DOM-007**：给定锁定路径 `/preferences/locations`，新提取结果不能覆盖该值，其余未锁定字段更新。
7. **DOM-A07 / DOM-008**：缺少任一必要不可变输入，或声明使用 enrichment 却未提供其 ID 时，构建 MatchResult 失败；不同 enrichment 生成不同匹配身份，建议版本不改变匹配身份。
8. **DOM-A08 / DOM-Q03**：键顺序不同但语义相同的输入产生相同哈希。

## 未解决问题

无。
