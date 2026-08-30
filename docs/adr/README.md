# 架构决策记录索引

- [ADR-0001：TypeScript 模块化单体（已被 ADR-0007 替代）](./0001-typescript-modular-monolith.md)
- [ADR-0002：SQLite 与本地文件存储](./0002-sqlite-local-storage.md)
- [ADR-0003：独立 Worker 与 SQLite 持久化队列](./0003-persistent-worker-queue.md)
- [ADR-0004：插件式官网来源适配器](./0004-source-adapter-boundary.md)
- [ADR-0005：确定性管道优先与轻量 Agent](./0005-deterministic-agent-boundary.md)
- [ADR-0006：来源事实、标准化事实与推导结果分层](./0006-fact-and-derivation-layers.md)
- [ADR-0007：Node 24 LTS 与包依赖边界](./0007-runtime-and-package-boundaries.md)
- [ADR-0008：官网列表同步与职位详情补全解耦](./0008-deferred-source-detail-enrichment.md)
- [ADR-0009：逻辑招聘渠道与物理官网来源分离](./0009-logical-channels-and-physical-sources.md)
- [ADR-0010：面试准备数据与外部 Agent 边界（已被 ADR-0013 部分取代）](./0010-interview-preparation-and-external-agent-boundaries.md)
- [ADR-0011：以通用事件和文件—实体模型收敛专用表（已被 ADR-0012 部分取代）](./0011-generic-events-and-file-entities.md)
- [ADR-0012：删除原始职位归档与 FTS 并固定文件实体命名](./0012-final-storage-convergence.md)
- [ADR-0013：深档文档取证与本机 Codex 面经研究执行（已被 ADR-0014 部分取代）](./0013-deep-drill-and-codex-research-execution.md)
- [ADR-0014：匿名隔离浏览器与受限 Codex 研究工具边界（已被 ADR-0015 部分取代）](./0014-isolated-browser-research-boundary.md)
- [ADR-0015：Worker 预采集证据与无网络 Agent 研究](./0015-worker-collected-research-evidence.md)

ADR 一经 Accepted 不直接改写历史结论；需要改变决策时新增 ADR，并把旧记录标为 Superseded。
