# 架构文档索引

- [总体架构](./overall-arch.md)：系统范围、模块、运行时和演进基线。
- [数据模型与 SQLite 表设计](./data-model.md)：表、约束、索引、事务、保留和迁移。
- [Worker、任务队列与并发设计](./worker-and-concurrency.md)：任务状态、领取、租约、调度、重试和恢复。
- [Agent、画像与匹配设计](./agent-and-matching.md)：Agent 协议、版本、缓存、画像合并、评分和评测。

改变总体依赖方向、数据所有权、进程职责或核心技术选择时，先新增/更新 `docs/adr/` 中的决策记录，再同步相关架构和规格。
