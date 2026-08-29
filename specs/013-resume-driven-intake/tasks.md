# 013 简历驱动的异步职位摄取任务

> 状态：Implemented

- [x] **INTAKE-T001** 更新应用 Web/CLI 契约，增加字节导入结果、初始化 bootstrap 结果、清理任务 payload/output Schema。（INTAKE-001, INTAKE-002, INTAKE-003, INTAKE-008, INTAKE-Q02）
- [x] **INTAKE-T002** 为 `ResumeProfileWorkflow` 增加字节导入入口并装配 Web multipart Route 与个人资料导入控件。（INTAKE-001, INTAKE-002, INTAKE-010, INTAKE-Q01, INTAKE-Q02）
- [x] **INTAKE-T003** 在 CLI 初始化后幂等导入默认简历；已有确认画像时入队启用来源同步并建立每日计划，未确认时仅建立每周清理计划。（INTAKE-003, INTAKE-004, INTAKE-008, INTAKE-Q03）
- [x] **INTAKE-T004** 增加 Worker 清理 Handler，并移除画像版本保存、来源同步和职位理解回调中的自动匹配入队。（INTAKE-005, INTAKE-008, INTAKE-Q04）
- [x] **INTAKE-T005** 将目标岗位映射为内部大职位类别，在同步入库前过滤不相关职位；补充单职位手动匹配所需的候选校验。（INTAKE-006, INTAKE-007, INTAKE-Q01）
- [x] **INTAKE-T006** 暴露 Web/CLI 手动刷新路径，更新个人资料页面文案和状态，并补浏览器/端到端测试。（INTAKE-009, INTAKE-010, INTAKE-Q01）
- [x] **INTAKE-T007** 运行格式、类型、应用/数据库/Web/Worker 风险匹配测试，核对契约追踪并将规格更新为 Implemented。（INTAKE-001, INTAKE-002, INTAKE-003, INTAKE-004, INTAKE-005, INTAKE-006, INTAKE-007, INTAKE-008, INTAKE-009, INTAKE-010, INTAKE-Q01, INTAKE-Q02, INTAKE-Q03, INTAKE-Q04）
- [x] **INTAKE-T008** 增加目标岗位大类单选与确认门禁：Web/API 阻止未确认时创建或启用同步，Worker 拒绝执行既有计划，并补应用、Web 与浏览器回归测试。（INTAKE-011）
- [x] **INTAKE-T009** 增加跨进程复用的来源同步计划对账，启动时为新增物理来源补齐计划并按当前渠道和目标岗位门禁启停。（INTAKE-012, INTAKE-Q03）
