# 004 官网来源适配器契约任务

> 状态：Implemented
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
