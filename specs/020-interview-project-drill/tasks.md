# 020 简历项目浅档拷打任务

> 状态：Implemented

- [x] **DRILL-T001** 增加面试准备领域类型、状态转换、覆盖维度和问题安全校验，并以单元测试固定不变量。（DRILL-003, DRILL-006, DRILL-009, DRILL-010, DRILL-011）
- [x] **DRILL-T002** 增加 `InterviewProjectRepository` 端口、SQLite 0017 迁移和仓储集成测试，覆盖快照幂等、问答修订、CAS、级联及 Artifact 引用。（DRILL-001, DRILL-002, DRILL-007, DRILL-009, DRILL-013）
- [x] **DRILL-T003** 实现内置 `resume-only@v1`、问题/摘要 Agent 定义和合约测试，确保空工具集、证据校验、偏移校验及禁止代答。（DRILL-004, DRILL-006, DRILL-008, DRILL-Q04）
- [x] **DRILL-T004** 实现档案和会话应用服务，接入 TaskService 的幂等、并发、重试和取消语义。（DRILL-001, DRILL-003, DRILL-005, DRILL-007, DRILL-010, DRILL-Q03）
- [x] **DRILL-T005** 实现 Worker 问题、摘要和 Markdown 投影 Handler，验证模型/文件操作位于事务外且失败互相隔离。（DRILL-005, DRILL-008, DRILL-012, DRILL-013, DRILL-Q01, DRILL-Q05）
- [x] **DRILL-T006** 实现 Web 契约、Route、导航、档案列表和逐题会话页面，覆盖空态、处理中、失败、修订、跳过、暂停/继续/完成和下载。（DRILL-001, DRILL-003, DRILL-005, DRILL-007, DRILL-010, DRILL-014, DRILL-Q02, DRILL-Q06）
- [x] **DRILL-T007** 实现删除影响预览、确认令牌、级联删除与未共享投影隔离，并补竞态和恢复测试。（DRILL-015）
- [x] **DRILL-T008** 运行格式、类型、Domain/Application/DB/Worker/Web 测试和浏览器可访问性检查，核对需求追踪并将规格状态更新为 Implemented。（DRILL-001–015, DRILL-Q01–Q06）
- [x] **DRILL-T009** 增加档案内全部拷打轮次索引，支持开始新轮后回看已完成对话并返回当前轮，补浏览器恢复流程。（DRILL-003, DRILL-014）
- [x] **DRILL-T010** 支持恢复已完成会话，按最后修改时间倒序展示“会话 - 时间”名称，并覆盖会话切换与继续修改流程。（DRILL-003, DRILL-007, DRILL-010, DRILL-014）
- [x] **DRILL-T011** 将问题生成改为 Web 同步执行，复用统一 Agent 校验并提供可取消等待态；回答摘要和投影仍由 Worker 承担。（DRILL-004, DRILL-005, DRILL-006, DRILL-Q01, DRILL-Q03）
- [x] **DRILL-T012** 为同步问题接口增加不含正文的真实阶段事件流，客户端展示准备、生成、校验和保存状态并保留取消与重试。（DRILL-005, DRILL-006, DRILL-Q03, DRILL-Q05）

## 验证记录

- 全仓类型检查、单元测试、文档追踪和依赖边界检查通过。
- 020 相关数据库集成测试、Web 生产构建、浏览器主流程和 1280/768 可访问性检查通过。
- 前端严格设计审计通过；020 变更文件的格式和 lint 检查通过。
- 全仓遗留门禁中仍有与 020 无关的来源同步、既有格式和 lint 失败，交付说明中单独记录，不改变本规格的实现状态。
