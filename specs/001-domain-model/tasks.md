# 001 核心领域模型任务

> 状态：Implemented
> 显式覆盖：DOM-001, DOM-002, DOM-003, DOM-004, DOM-005, DOM-006, DOM-007, DOM-008, DOM-009, DOM-010, DOM-Q01, DOM-Q02, DOM-Q03

- [x] **DOM-T001** 建立 `packages/domain`、严格 TS 配置和公开入口；验证领域包依赖图不包含基础设施包。（DOM-Q01）
- [x] **DOM-T002** 实现 branded ID、Clock、IdGenerator、UtcInstant、ContentHash 和领域错误；添加单元测试。（DOM-001,009,010）
- [x] **DOM-T003** 实现 NormalizedJob Schema、规范序列化和哈希；添加等价输入属性测试。（DOM-002, DOM-Q03）
- [x] **DOM-T004** 实现职位合并与 Revision 决策，覆盖相同/变化/来源身份冲突。（DOM-002,004）
- [x] **DOM-T005** 实现职位状态机和完整性门控，表驱动覆盖 active/stale/closed 全部转换。（DOM-003,005,006）
- [x] **DOM-T006** 实现画像 Schema、版本合并及 JSON Pointer 锁定规则。（DOM-007）
- [x] **DOM-T007** 实现匹配输入身份与版本不变量。（DOM-008）
- [x] **DOM-T008** 导出公共测试工厂到 `packages/testkit`，执行类型检查和单元测试。（DOM-Q02）
