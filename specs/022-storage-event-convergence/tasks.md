# 022 存储与事件模型收敛任务

> 状态：In Progress

- [x] **SEC-T001** 审计全部业务表并记录保留、合并、删除依据。（SEC-001）
- [x] **SEC-T002** 调研 Cloudreve 文件/Blob 所有权模型，固定通用事件与文件—实体决策及 ADR。（SEC-002, SEC-003, SEC-004, SEC-005, SEC-006, SEC-Q03）
- [ ] **SEC-T003** 实现 `0019` 数据迁移与 Drizzle Schema，覆盖旧数据转换、原始职位和 FTS 删除、共享实体、五版本上限和旧表删除。（SEC-004, SEC-005, SEC-006, SEC-007, SEC-008, SEC-009, SEC-010, SEC-Q01, SEC-Q05）
- [ ] **SEC-T004** 改造 Artifact Store、简历、面经、职位修订、项目笔记、删除、清理、备份和 doctor 链路。（SEC-004, SEC-005, SEC-006, SEC-007, SEC-008, SEC-009, SEC-Q02, SEC-Q04）
- [ ] **SEC-T005** 将四类专用记录迁入通用事件并恢复诊断/审计读取。（SEC-002, SEC-003, SEC-009, SEC-010）
- [ ] **SEC-T006** 删除简历润色结果副本，改由 Task + AgentRun 读取并补回归测试。（SEC-011）
- [ ] **SEC-T007** 更新总体架构、数据模型和受影响规格，运行格式、lint、类型检查及风险相关测试。（SEC-001, SEC-002, SEC-003, SEC-004, SEC-005, SEC-006, SEC-007, SEC-008, SEC-009, SEC-010, SEC-011, SEC-Q01, SEC-Q02, SEC-Q03, SEC-Q04, SEC-Q05）
