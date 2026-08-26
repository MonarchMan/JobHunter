# 005 职位同步流水线设计

> 状态：Implemented

## 应用服务

`JobSyncService.run(command, signal)` 负责运行级编排：

1. 校验来源和互斥条件，创建 SyncRun。
2. 从 Adapter Registry 取得实例，在事务外执行 discover 和列表 normalize；列表同步不执行 fetchDetail。
3. 每个职位生成原始内容哈希并存储 Artifact/RawJobRecord。
4. 调用领域合并规则，使用 UnitOfWork 写 Job、Revision、Observation、Event。
5. 记录 seen job IDs；大来源使用临时表 `sync_seen_jobs(run_id, job_id)`，不在内存保存全集。
6. 完成发现后，只有 complete 才批量处理未观察职位。
7. 提交 cursor、统计和健康状态，并入队后续任务。SyncRun 固化 adapter、normalizer、policy 版本与配置哈希，Revision 固化 normalizer 版本，状态事件证据包含 policy 版本。

deferred 详情在独立 `source.job-detail` 队列执行。列表职位通过地域和画像 intake 后，按 `(sourceId, externalJobId, listContentHash, adapterVersion)` 创建幂等任务。任务读取固定的列表输入、请求详情、更新详情缓存，并按需创建 JobRevision；失败写入详情状态和任务错误，不回写 SyncRun coverage/health。后续列表同步优先复用已缓存详情，避免把已补全职位降回基础字段。

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

健康状态根据列表采集完整性和运行级错误更新：complete 且无严重列表质量错误时清零 failures；分页 partial 或 failed 增加失败计数；少量且具有稳定 externalJobId 的隔离只进入数据质量诊断。详情补全、意向外、非境内和地域不明职位不改变 coverage 或来源健康。temporary/rate-limited partial 在保存本次运行后由任务队列退避重试。

同一来源的运行互斥由 `sync_runs` 唯一索引保证。创建运行时，仓储先将早于 15 分钟恢复窗口的 running 记录结束为 cancelled/orphaned_run，再尝试插入新运行；窗口内的 running 记录仍返回 conflict。孤儿运行属于进程中断而非来源故障，因此不累计来源失败次数。恢复窗口大于来源同步任务的默认 10 分钟租约，既避免活跃任务被抢占，也防止进程崩溃留下永久锁。

## 后续任务顺序

新 Revision 同时产生不依赖模型的基础匹配任务，以及可选的 `job.enrich` 任务。基础匹配使用 `jobEnrichmentIdOrNone = none`；enrichment 成功后以其不可变 ID 产生新的匹配任务。两类 MatchResult 均保留，当前查询优先选择与活动 enrichment 配置匹配的结果，模型不可用时回退基础结果。JobAdvice 只在选定 MatchResult 后运行并写入独立 MatchAdvice。

## 可观测性

按 runId 聚合 discovered、rawStored、created、unchanged、revised、restored、staled、closed、isolated、skippedOutOfScope、followupEnqueued。职位理解和匹配不属于同步后续任务，`followupEnqueued` 必须保持为 0；最终必须满足可推导计数等式，否则运行标记 failed/internal_invariant。

## 测试

使用 FakeAdapter 与真实临时 SQLite 测试所有验收场景。失败注入点覆盖分页、详情、文件、每个事务阶段、任务入队和取消。
