# 001 核心领域模型设计

> 状态：Implemented

## 模块

`packages/domain` 按子域导出：

```text
domain/
├─ company/
├─ job/
├─ sync/
├─ profile/
├─ matching/
├─ task/
├─ shared/
└─ index.ts
```

各子目录只从 `shared` 导入；跨子域协作由 `packages/application` 完成，避免领域对象彼此形成大型依赖图。

## 核心类型

- Branded ID：`CompanyId`、`JobId` 等，运行时仍为 UUIDv7 文本。
- 值对象：`SourceJobIdentity`、`CanonicalUrl`、`ContentHash`、`UtcInstant`、`RevisionNumber`。
- 枚举：`JobStatus`、`SyncCoverage`、`SyncRunStatus`、`TaskStatus`、`HealthStatus`。
- 领域结果：`JobMergeDecision`、`StatusTransition`、`ProfileMergeDecision`、`RuleOutcome`。

`NormalizedJob` Zod Schema 与 TS 类型从同一声明导出。规范序列化器负责数组排序策略、空白规范化、空值表达和键排序；适配器不能自行计算最终内容哈希。

## 规则服务

- `decideJobMerge(current, incoming)`：产生 create/unchanged/revise 决策，不写库。
- `decideMissingTransition(job, coverage, policy)`：计算缺失计数和状态事件。
- `decideObservedTransition(job)`：恢复状态、更新末见时间。
- `mergeProfileVersion(previous, extracted, lockedPaths, preferences)`：生成有效画像。
- `buildMatchIdentity(profileVersion, jobRevision, enrichmentIdOrNone, ruleset)`：生成确定性匹配输入哈希；MatchAdvice 使用独立 Agent cache identity。

状态转换返回意图，由应用层在一个事务中持久化 Job、Revision、Observation 和 StatusEvent。

## 错误

使用 `DomainError { code, message, details? }`。`details` 只包含非敏感结构化值。基础设施异常在应用边界映射为应用错误，不进入领域包。

## 测试设计

- 表驱动测试覆盖所有职位状态转移和阈值边界。
- 属性测试验证规范序列化对键顺序和无意义空白稳定。
- 固定时钟与固定 ID 验证事件结果。
- profile merge 测试 JSON Pointer 父子锁定、缺失路径和类型变化。

对应需求：DOM-001..010、DOM-Q01..03。
