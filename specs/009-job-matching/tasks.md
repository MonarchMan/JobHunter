# 009 职位匹配与建议任务

> 状态：Implemented
> 显式覆盖：MCH-001, MCH-002, MCH-003, MCH-004, MCH-005, MCH-006, MCH-007, MCH-008, MCH-009, MCH-010, MCH-011, MCH-Q01, MCH-Q02, MCH-Q03, MCH-Q04

- [x] **MCH-T001** 定义 JobUnderstanding Schema、Agent 和 enrichment Handler。（MCH-001）
- [x] **MCH-T002** 实现 RuleOutcome、首期资格规则和 pass/fail/unknown 测试。（MCH-002）
- [x] **MCH-T003** 实现 Ruleset v1、五维 scorer、证据与权重校验。（MCH-003,004）
- [x] **MCH-T004** 实现包含 JobEnrichmentIdOrNone 的匹配 inputHash、不可变 MatchResult 与幂等 Repository。（MCH-005）
- [x] **MCH-T005** 实现基础/enrichment-aware 版本触发、分页批量匹配和 AbortSignal。（MCH-006, MCH-Q02）
- [x] **MCH-T006** 实现当前结果筛选、active/stale/closed 语义和稳定排序。（MCH-007,010,011）
- [x] **MCH-T007** 定义 JobAdviceAgent、独立 MatchAdvice Repository、当前建议选择和失败重试连接。（MCH-008,009）
- [x] **MCH-T008** 建立匹配黄金集和 Top-K/误杀/事实一致性评测。（MCH-Q03）
- [x] **MCH-T009** 添加无模型配置下完整确定性匹配端到端测试。（MCH-Q04）
