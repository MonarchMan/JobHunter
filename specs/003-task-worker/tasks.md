# 003 持久化任务与 Worker 任务

> 状态：Implemented
> 显式覆盖：WRK-001, WRK-002, WRK-003, WRK-004, WRK-005, WRK-006, WRK-007, WRK-008, WRK-009, WRK-010, WRK-011, WRK-012, WRK-013, WRK-014, WRK-015, WRK-Q01, WRK-Q02, WRK-Q03

- [x] **WRK-T001** 实现 HandlerRegistry、payload Schema 和任务应用端口。（WRK-001, WRK-Q03）
- [x] **WRK-T002** 实现入队、幂等冲突返回和任务查询。（WRK-001,010）
- [x] **WRK-T003** 实现 `BEGIN IMMEDIATE` 原子领取与租约条件更新测试。（WRK-002,003）
- [x] **WRK-T004** 实现心跳、过期恢复和尝试耗尽逻辑。（WRK-004）
- [x] **WRK-T005** 实现错误分类、Retry-After、指数退避和确定性抖动测试。（WRK-005,006）
- [x] **WRK-T006** 实现 schedules 轮询、occurrence 幂等和错过周期策略。（WRK-007,008）
- [x] **WRK-T007** 实现 Worker 进程装配、空队列退避和优雅关闭。（WRK-009, WRK-Q01）
- [x] **WRK-T008** 实现 cancel/retry 用例和跨循环取消检查。（WRK-010）
- [x] **WRK-T009** 添加崩溃恢复、双领取者和敏感日志测试。（WRK-Q02）
- [x] **WRK-T010** 按 task type 建立独立 ClaimLoop、领取过滤和类型间非阻塞测试。（WRK-011）
- [x] **WRK-T011** 支持按 task type 配置消费槽位数量，并验证同类型并发与默认单消费者行为。（WRK-012）
- [x] **WRK-T012** 将 `maxConcurrentNetworkTasks` 接为来源 HTTP、浏览器和模型调用共享的可取消 FIFO 异步信号量，并验证全局上限与排队取消。（WRK-013）
- [x] **WRK-T013** 接入按来源元数据配置的可取消 Token Bucket、I/O 任务默认消费槽位和无敏感内容的 Worker 运行时指标。（WRK-014,015, WRK-Q02）
