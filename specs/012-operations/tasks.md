# 012 配置、可观测性与运维任务

> 状态：Implemented
> 显式覆盖：OPS-001, OPS-002, OPS-003, OPS-004, OPS-005, OPS-006, OPS-007, OPS-008, OPS-009, OPS-010, OPS-Q01, OPS-Q02, OPS-Q03, OPS-Q04

- [x] **OPS-T001** 定义 BootstrapConfig/AppConfig 两阶段解析、`JOBHUNTER_` 环境映射、优先级和 SecretString。（OPS-001, OPS-Q02）
- [x] **OPS-T002** 实现 SafeLogger、Pino sink、字段级 redactor 和日志泄漏测试。（OPS-003,004, OPS-Q01）
- [x] **OPS-T003** 实现离线 doctor、required/degraded 结果和版本诊断。（OPS-002,005,006,010）
- [x] **OPS-T004** 实现显式 online 来源 health check，证明不做完整同步或模型调用。（OPS-Q04）
- [x] **OPS-T005** 实现 SQLite 快照驱动的备份 create/list/verify 与引用文件清单哈希。（OPS-007）
- [x] **OPS-T006** 实现 restore 独占连接 preflight、OperationPlan、confirmationToken、临时恢复和旧目录回滚。（OPS-007, OPS-Q03）
- [x] **OPS-T007** 实现 cleanup 策略、24 小时安全窗口、孤立文件检测、dry-run 和路径边界。（OPS-008, OPS-Q03）
- [x] **OPS-T008** 实现敏感数据删除影响计划和审计事件。（OPS-009）
- [x] **OPS-T009** 添加 Windows 路径、篡改备份、日志秘密和配置优先级端到端测试。（OPS-Q01..04）
