# 005 职位同步流水线设计

> 状态：Implemented

## 应用服务

`JobSyncService.run(command, signal)` 负责运行级编排：

1. 校验来源和互斥条件，创建 SyncRun。
2. 从 Adapter Registry 取得实例，在事务外执行 discover/fetch/normalize。
3. 每个职位生成原始内容哈希并存储 Artifact/RawJobRecord。
4. 调用领域合并规则，使用 UnitOfWork 写 Job、Revision、Observation、Event。
5. 记录 seen job IDs；大来源使用临时表 `sync_seen_jobs(run_id, job_id)`，不在内存保存全集。
6. 完成发现后，只有 complete 才批量处理未观察职位。
7. 提交 cursor、统计和健康状态，并入队后续任务。SyncRun 固化 adapter、normalizer、policy 版本与配置哈希，Revision 固化 normalizer 版本，状态事件证据包含 policy 版本。

`sync_seen_jobs` 是运行时辅助表，可在运行结束后清理；其 Schema 纳入初始迁移但不属于长期领域事实。

## 事务边界

- 创建/完成 SyncRun：各一个短事务。
- 每个职位合并：一个短事务。
- 未观察状态处理：按固定批次（默认 100）事务。
- 后续任务与产生它的 Revision 在同事务入队，依靠 idempotency key 去重。

原始文件在事务前原子写入；事务失败产生的未引用 Artifact 由维护任务清理。

## 覆盖度与失败项身份

Adapter 结束时提供 coverage，但应用层只在以下证据同时成立时接受 `complete`：分页/游标正常终止；所有发现项都有稳定 identity；每个已存在 identity 已写入 Observation；没有访问阻断、取消或运行级解析变化。

详情或 normalize 失败时，若 discover 阶段已有稳定 externalJobId 且数据库存在对应 Job，流水线保存 RawJobRecord 和 Observation，但不更新 Job/Revision；这不会破坏“未出现”判断。若失败项身份不可靠、列表页本身解析失败或无法证明分页完整，coverage 强制降为 partial/unknown。错误数量阈值只用于决定是否继续收集诊断，不得用于把存在未归属失败项的运行提升为 complete。

健康状态根据连续运行结果更新：成功清零 failures；partial 增加退化计数；failed 增加失败计数；达到策略阈值转 degraded/unhealthy。

## 后续任务顺序

新 Revision 同时产生不依赖模型的基础匹配任务，以及可选的 `job.enrich` 任务。基础匹配使用 `jobEnrichmentIdOrNone = none`；enrichment 成功后以其不可变 ID 产生新的匹配任务。两类 MatchResult 均保留，当前查询优先选择与活动 enrichment 配置匹配的结果，模型不可用时回退基础结果。JobAdvice 只在选定 MatchResult 后运行并写入独立 MatchAdvice。

## 可观测性

按 runId 聚合 discovered、rawStored、created、unchanged、revised、restored、staled、closed、isolated、followupEnqueued。最终必须满足可推导计数等式，否则运行标记 failed/internal_invariant。

## 测试

使用 FakeAdapter 与真实临时 SQLite 测试所有验收场景。失败注入点覆盖分页、详情、文件、每个事务阶段、任务入队和取消。
