# 016 官网来源扩展与目录分层任务

> 状态：Implemented
> 显式覆盖：OSE-001, OSE-002, OSE-003, OSE-004, OSE-005, OSE-006, OSE-007, OSE-008, OSE-009, OSE-010, OSE-011, OSE-012

- [x] **OSE-T001** 保存既有 catalog/registry 稳定字段测试，按 company/channel 迁移现有模块。（OSE-001..004）
- [x] **OSE-T002** 将 catalog 拆为显式 company/source records 和 registry 装配，消除平行数组。（OSE-003,004）
- [x] **OSE-T003** 完成五家公司匿名官网 Spike，记录入口、协议、ID、分页、深链和限制。（OSE-005..010）
- [x] **OSE-T004** 实现小米实习、vivo 社招、OPPO 实习和网易混合来源及固定样本。（OSE-005..009）
- [x] **OSE-T005** 实现 360 浏览器 JSON 实验适配器；门禁未闭合时默认关闭。（OSE-005,010）
- [x] **OSE-T006** 补齐 catalog、契约、类别、partial、seed 幂等和在线 Smoke 测试。（OSE-006..012）
- [x] **OSE-T007** 更新支持矩阵并运行格式、类型、单元、集成和边界检查。（OSE-009,011,012）

## 验证记录

- 2026-08-28：新增来源固定样本、公共契约、catalog 与分页异常测试通过；数据库 seed 验证 15 家公司、18 个来源。
- 2026-08-28：vivo、OPPO 全量匿名 JSON 在线门禁通过并标记 `supported`；360 匿名浏览器列表门禁通过但详情未闭合，保持 `experimental`；小米、网易直接 HTTP 全量门禁触发官网访问校验，保持 `experimental`。
- 2026-08-28：根类型检查、定向 ESLint、文档检查和依赖边界检查通过。完整旧来源测试仍有两个与本变更无关的基线断言：标准地点排序顺序，以及已有同步流程的 follow-up 计数。
