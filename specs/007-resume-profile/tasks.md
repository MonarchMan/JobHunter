# 007 简历导入与候选人画像任务

> 状态：Implemented
> 显式覆盖：RES-001, RES-002, RES-003, RES-004, RES-005, RES-006, RES-007, RES-008, RES-009, RES-010, RES-011, RES-012, RES-013, RES-014, RES-015, RES-016, RES-Q01, RES-Q02, RES-Q03, RES-Q04, RES-Q05, RES-Q06

- [x] **RES-T001** 实现媒体探测、大小限制、Artifact 去重和 ResumeDocument 创建。（RES-001,002）
- [x] **RES-T002** 实现 PDF/DOCX/TXT 解析器、质量阈值和 fixtures。（RES-003,004）
- [x] **RES-T003** 定义画像、偏好、证据和锁定路径 Schema。（RES-005..007）
- [x] **RES-T004** 实现 ResumeProfileAgent 定义、任务 Handler 和幂等缓存连接。（RES-005, RES-Q03,04）
- [x] **RES-T005** 实现画像合并、乐观冲突、current 切换和历史查询。（RES-007..009）
- [x] **RES-T006** 实现偏好更新与人工修正用例。（RES-006,007）
- [x] **RES-T007** 实现删除影响预览和清理任务接口，不在普通命令中隐式删除。（RES-010）
- [x] **RES-T008** 添加日志敏感信息测试、重复/取消/失败集成测试。（RES-Q01..04）
  - 已覆盖真实脱敏 DOCX、重复导入、低质量文本、写入前取消、Agent 缓存、无效输出、限流失败、日志脱敏，以及删除确认、回滚和清理重试。
- [x] **RES-T009** 定义经历润色 Agent、最小输入、结构化输出及事实保持校验。（RES-011, RES-012, RES-Q05）
- [x] **RES-T010** 实现润色建议仓储、后台任务 Handler、Web 提交与状态查询用例。（RES-011, RES-012, RES-013, RES-014, RES-Q04, RES-Q05）
- [x] **RES-T011** 在在线简历加入章节选择、生成状态、建议预览与显式应用交互。（RES-011, RES-013, RES-014）
- [x] **RES-T012** 添加 Agent、应用、数据库、Web 与浏览器回归测试。（RES-011, RES-012, RES-013, RES-014, RES-Q04, RES-Q05）
- [x] **RES-T013** 实现保守的章节与经历条目规则提取器，输出完整画像或非敏感 fallback 原因。（RES-015, RES-016, RES-Q06）
- [x] **RES-T014** 在画像任务中接入规则优先路径，规则成功不创建 AgentRun，失败完整回退现有 Agent。（RES-015, RES-016）
- [x] **RES-T015** 添加规则命中、歧义回退、OCR 后规则命中及 AgentRun 数量回归测试。（RES-015, RES-016, RES-Q04, RES-Q06）
- [x] **RES-T016** 将画像历史收敛为最新 5 个版本，并清理被淘汰版本的可重算匹配推导。（RES-008）
- [x] **RES-T017** 将 ResumeProfileAgent 升级为 v2，分离投递用完整专业技能句子与匹配用结构化技能名，并补充规则/Agent 回归测试。（RES-005）
