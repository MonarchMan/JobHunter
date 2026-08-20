# 005 职位同步流水线任务

> 状态：Implemented
> 显式覆盖：SYNC-001, SYNC-002, SYNC-003, SYNC-004, SYNC-005, SYNC-006, SYNC-007, SYNC-008, SYNC-009, SYNC-010, SYNC-011, SYNC-012, SYNC-Q01, SYNC-Q02, SYNC-Q03, SYNC-Q04

- [x] **SYNC-T001** 实现 SyncRun 创建/结束、来源互斥和运行统计对象。（SYNC-001,002,012）
- [x] **SYNC-T002** 实现流式 discover/fetch/normalize 编排与 AbortSignal 传播。（SYNC-003, SYNC-Q01）
- [x] **SYNC-T003** 实现原始文件/记录保存和单职位 UnitOfWork 合并。（SYNC-003..006, SYNC-Q02）
- [x] **SYNC-T004** 增加 `sync_seen_jobs` 迁移与按批未观察处理。（SYNC-007,008）
- [x] **SYNC-T005** 实现游标提交、失败项身份处理和严格 coverage 降级。（SYNC-007,009,011）
- [x] **SYNC-T006** 实现基础匹配 → enrichment → enrichment-aware 匹配 → advice 的幂等后续任务，以及关闭/恢复行为。（SYNC-010）
- [x] **SYNC-T007** 实现来源健康状态与统计一致性校验。（SYNC-012）
- [x] **SYNC-T008** 使用 FakeAdapter 添加首次、重放、变化、部分失败、取消、关闭、恢复集成测试。（SYNC-Q03）
- [x] **SYNC-T009** 添加原始数据大小限制、隔离与日志脱敏测试。（SYNC-Q04）
