# 005 职位同步流水线任务

> 状态：Implemented
> 显式覆盖：SYNC-001, SYNC-002, SYNC-003, SYNC-004, SYNC-005, SYNC-006, SYNC-007, SYNC-008, SYNC-009, SYNC-010, SYNC-011, SYNC-012, SYNC-013, SYNC-014, SYNC-015, SYNC-016, SYNC-017, SYNC-018, SYNC-Q01, SYNC-Q02, SYNC-Q03, SYNC-Q04

- [x] **SYNC-T001** 实现 SyncRun 创建/结束、来源互斥和运行统计对象。（SYNC-001,002,012）
- [x] **SYNC-T002** 实现流式 discover/fetch/normalize 编排与 AbortSignal 传播。（SYNC-003, SYNC-Q01）
- [x] **SYNC-T003** 实现标准化、职位类别归一化、意向过滤后的原始文件/记录保存和单职位 UnitOfWork 合并。（SYNC-003..006, SYNC-Q02）
- [x] **SYNC-T004** 增加 `sync_seen_jobs` 迁移与按批未观察处理。（SYNC-007,008）
- [x] **SYNC-T005** 实现游标提交、失败项身份处理和严格 coverage 降级。（SYNC-007,009,011）
- [x] **SYNC-T006** 移除同步产生的匹配、职位理解和建议后续任务，保留关闭/恢复行为；具体职位匹配由显式手动任务负责。（SYNC-010）
- [x] **SYNC-T007** 实现来源健康状态与统计一致性校验。（SYNC-012）
- [x] **SYNC-T008** 使用 FakeAdapter 添加首次、重放、变化、部分失败、取消、关闭、恢复集成测试。（SYNC-Q03）
- [x] **SYNC-T009** 添加原始数据大小限制、隔离与日志脱敏测试。（SYNC-Q04）
- [x] **SYNC-T010** 将意向和地域过滤定义为成功统计，不再误降级运行或来源健康。（SYNC-013）
- [x] **SYNC-T011** 为超时孤儿运行增加恢复窗口，同时保留活跃运行互斥。（SYNC-002,014）
- [x] **SYNC-T012** 将详情请求拆为 intake 后的独立幂等任务，并使列表同步复用详情缓存。（SYNC-015）
- [x] **SYNC-T013** 拆分列表健康与详情失败，支持 temporary partial 重试及结构化覆盖/隔离诊断。（SYNC-016,017）
- [x] **SYNC-T014** 让新建 SyncRun 持久化完整零值统计，并把存量统计破坏性投影为当前字段集合，保证任务诊断可解析。（SYNC-018）
