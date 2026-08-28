# 017 官网三渠道来源任务

> 状态：Implemented
> 显式覆盖：TCS-001, TCS-002, TCS-003, TCS-004, TCS-005, TCS-006, TCS-007, TCS-008, TCS-009

> 演进说明：任务完成记录保持不变；018 负责将 45 条持续约束迁移到逻辑渠道，并解除物理来源数量限制。

- [x] **TCS-T001** 扩展 catalog channel 模型并补齐 15×3 稳定来源矩阵。（TCS-001, TCS-002, TCS-006, TCS-008）
- [x] **TCS-T002** 实现不可用来源适配器并注册所有 catalog key。（TCS-003, TCS-004, TCS-005）
- [x] **TCS-T003** 接入已有真实但未注册的渠道，并拆分网易 canonical channel。（TCS-004, TCS-006）
- [x] **TCS-T004** 更新 Web 频道映射、支持矩阵、seed 和契约测试。（TCS-007, TCS-008, TCS-009）
- [x] **TCS-T005** 运行格式、类型、单元、集成、文档和依赖边界验证。（TCS-009）

## 验证记录

- 2026-08-28：catalog 验证 15 家公司、45 个唯一 source UUID/slug/key，每家公司严格包含 `intern/campus/social`。
- 2026-08-28：Registry 逐条解析 45 个来源；blocked adapter 的 health/discovery 均返回 `access_blocked`，不会伪造空列表成功。
- 2026-08-28：数据库幂等 seed 与 Web repository 验证每家公司稳定暴露 `internship/campus/social` 三个单一频道。
- 2026-08-28：sources 单测 72/72、来源数据库集成测试 3/3、根类型检查、定向 ESLint、文档检查和依赖边界检查通过。
