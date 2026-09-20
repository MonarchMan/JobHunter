# 架构决策记录索引

- [ADR-0028：智联校园使用已观察请求模板初始化 HTTP 会话](./0028-zhilian-observed-request-template.md)

- [ADR-0022：简历编辑画布的 WebKit 事件边界](./0022-resume-studio-webkit-event-boundary.md)

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
- [ADR-0013：深档文档取证与本机 Codex 面经研究执行（已被 ADR-0014、ADR-0018 部分取代）](./0013-deep-drill-and-codex-research-execution.md)
- [ADR-0014：匿名隔离浏览器与受限 Codex 研究工具边界（已被 ADR-0015 部分取代）](./0014-isolated-browser-research-boundary.md)
- [ADR-0015：Worker 预采集证据与无网络 Agent 研究](./0015-worker-collected-research-evidence.md)
- [ADR-0016：版本化简历模板与 Worker PDF 导出](./0016-resume-template-rendering-and-export.md)
- [ADR-0017：网友面经来源正文仅用于瞬时核验](./0017-transient-community-source-verification.md)
- [ADR-0018：项目拷打问题由 Web 同步生成](./0018-synchronous-project-question-generation.md)

ADR 一经 Accepted 不直接改写历史结论；需要改变决策时新增 ADR，并把旧记录标为 Superseded。

- [ADR-0019：任务诊断写入投影与批量读取](./0019-task-diagnostic-projection.md)

- [ADR-0020：SQLite 阈值维护与跨进程写入保护](./0020-sqlite-automatic-maintenance.md)
- [ADR-0021：Agent 业务校验与评分阶段恢复](./0021-agent-output-validation-and-score-recovery.md)
- [ADR-0023：官网原始请求运行时驱动](./0023-official-runtime-source-driver.md)
- [ADR-0024：列表无正文时先取得必需详情再入库](./0024-required-job-detail.md)
- [ADR-0025：招聘平台按需读取与统一职位生命周期](./0025-platform-browsing-and-unified-job-lifecycle.md)
- [ADR-0026：平台 CDP 连接与用户活动会话同寿命](./0026-platform-cdp-session-lifetime.md)
- [ADR-0027：平台实例隔离与显式浏览活动](./0027-platform-isolation-and-view-activity.md)
- [ADR-0029：前程无忧按官网已观察批次执行独立 HTTP](./0029-job51-observed-batch-session.md)
