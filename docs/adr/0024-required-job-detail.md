# ADR-0024：列表无正文时先取得必需详情再入库

- 状态：Accepted
- 日期：2026-09-11
- 关联规格：[026 第二批官网来源扩展](../../specs/026-official-source-wave-two/spec.md)（SWT-016）

## 背景

滴滴社招与实习公开列表没有职责正文。现有 deferred 先用列表归一化入库再排详情补充任务，不能处理严格拒绝空正文的来源；占位正文会污染职位事实，不能用来通过同步链。

## 决策

SourceCapabilities.detail 增加 required，与 inline、deferred 区分。Registry 要求 required 提供 fetchDetail。JobSyncService 在 Worker 执行的同步流程中逐条串行调用该来源详情，再执行归一化和入库；网络请求位于事务外，复用来源超时、限流和浏览器池。详情失败进入既有条目隔离分支，不创建虚假岗位；已有岗位保留隔离观察语义。

required 不排补充详情任务，不修改原有 deferred 缓存/异步补充行为。公司协议与 fetchDetail 仍由 sources 实现；应用仅基于契约编排，不能导入 sources 或浏览器实现。在线 smoke 不执行全量同步，仅验证首尾列表和一条详情；SQLite 测试用合成响应验证完整流程。

## 后果与验证

新模式会对每个发现的在招岗位请求详情，成本高于内联来源，但不牺牲正文真实性。滴滴社招与实习启用 required；常规校招和未来精英保持 inline。契约/Registry、SQLite 成功及详情失败隔离、partial 不误下线均需要回归；无需数据库迁移或新进程。
