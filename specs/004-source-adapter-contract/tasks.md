# 004 官网来源适配器契约任务

> 状态：Implemented

- [x] **SRC-T011** 添加快手重复 ID/页码诊断及有界重读回归，覆盖恢复、持续重复、采样和总数变化。（SRC-014）

- [x] **SRC-T010** 实现 Worker 官网浏览器进程复用、请求上下文隔离、失败恢复及退出清理回归。（SRC-013）

2026-09-29 验证：浏览器专项17项、Worker/CLI单元81项通过；类型、改动代码ESLint、文档与依赖边界检查通过。真实Chrome本地HTTP夹具连续3次请求仅启动1次，3次均未携带上一请求Cookie，每次完成后上下文数为0，退出后进程断开。Worker直接入口和CLI入口均在finally关闭；一次性探测保持用完关闭。未重启运行中的Worker、未访问招聘网站或修改运行数据库。

> 显式覆盖：SRC-001, SRC-002, SRC-003, SRC-004, SRC-005, SRC-006, SRC-007, SRC-008, SRC-009, SRC-010, SRC-011, SRC-012, SRC-Q01, SRC-Q02, SRC-Q03, SRC-Q04

- [x] **SRC-T001** 定义 metadata、capability、discover/fetch/normalize/health 类型与 Zod Schema。（SRC-001..004）
- [x] **SRC-T002** 实现 external ID 指纹版本与官方 URL 规范策略。（SRC-005,006）
- [x] **SRC-T003** 实现错误分类、AbortSignal、超时和响应大小限制的 SourceHttpClient。（SRC-007,008）
- [x] **SRC-T004** 实现 AdapterRegistry 与启动配置校验。（SRC-001, SRC-Q03）
- [x] **SRC-T005** 建立 healthCheck 公共结果和关键解析信号约定。（SRC-009）
- [x] **SRC-T006** 建立契约测试套件、固定样本格式和敏感内容扫描。（SRC-010, SRC-Q04）
- [x] **SRC-T007** 添加 HTTP、HTML 和浏览器策略选择文档/示例适配器。（SRC-Q01,02）
- [x] **SRC-T008** 为适配器增加外部职位类别到内部大/小标签的映射约定，并将不可识别值归入“其他”。（SRC-011）
- [x] **SRC-T009** 为 partial/unknown completion 增加结构化覆盖诊断，并记录总数、页数、重复 ID、原因和可重试性。（SRC-012）
