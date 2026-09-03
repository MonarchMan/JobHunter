# 003 持久化任务与 Worker 设计

> 状态：Implemented

实现遵循 [Worker 与并发设计](../../docs/arch/worker-and-concurrency.md)。

## 包与入口

- `packages/application/tasks`：enqueue、cancel、retry、query 用例。
- `packages/db/repositories/task-repository`：原子领取和状态转换。
- `apps/worker`：生命周期、循环和 Handler 装配。

Handler 定义 payload/output Schema、默认 maxAttempts、lease duration 和 `execute(ctx, payload)`。`ctx` 提供 AbortSignal、Clock、Logger 和受限应用服务。

## 循环

Scheduler 与 ClaimLoop 独立运行。每个已注册 task type 按 `taskTypeConcurrency` 配置启动一个或多个消费槽位，每个槽位拥有独立 ClaimLoop，并在领取 SQL 中固定 `task_type`；未配置类型默认启动一个槽位。领取后在事务外执行 Handler，因此某一类型的积压或慢任务不会占用其他类型的领取循环。成功/失败更新使用 `WHERE id=? AND lease_owner=? AND status='running'`，租约丢失时不得覆盖新持有者结果。多槽位仍受持久化 `concurrency_key` 约束，不能并行执行互斥任务。

Worker 组合根创建一个容量为 `maxConcurrentNetworkTasks` 的 FIFO 异步信号量，并将同一实例装饰到来源 HTTP、浏览器采集和 ModelClient 边界。许可只覆盖一次完整网络操作及响应读取，不覆盖任务中的解析和数据库事务；等待许可使用 Promise，不创建阻塞线程。排队项监听任务 `AbortSignal`，取消时从队列移除。该上限与 `taskTypeConcurrency` 分工：后者决定可同时推进多少任务，前者限制这些任务合计产生多少在途网络操作。

来源 HTTP 和浏览器采集在申请全局许可前，先经过按 adapter key 隔离的 Token Bucket。桶容量使用来源 `burst`，补充速度使用 `requestsPerMinute`；因此单来源遵守官网节奏，不同来源仍可并发。生产默认消费槽位为 `source.sync=3`、`source.job-detail=4`、`source.health-check=2`，其他任务保持 1，并始终受全局网络上限和持久化 concurrency key 约束。

Worker 使用 Node 事件循环延迟直方图周期输出 `worker.runtime`，只记录网络 active/queued 和 P95 延迟，不记录 URL、请求或响应正文。该指标用于决定是否继续增加异步并发，或将 OCR/重解析等 CPU 工作迁移到独立线程/进程。

Cron 解析使用 `cron-parser` 和 IANA timezone；计算结果统一转换为 UTC epoch milliseconds 后持久化。夏令时重复/跳过时以库的时区语义为准，并用 occurrence UTC 时间参与幂等键。

重试由 `RetryPolicy` 产生 `availableAt`；测试注入确定性随机数。手动 retry 创建新任务幂等键后缀并关联原失败任务，保留审计链。

## 取消

pending 直接转 cancelled。running 写入取消请求并通过当前进程内 AbortController 立即通知；跨进程 Worker 在心跳时检查取消。Handler 必须在分页、模型调用和批处理边界检查信号。默认由取消获胜；只有在最终业务事务同时核验当前 Task、`running` 状态与未取消条件的 Handler 才能声明 `lateCancellationPolicy = complete`。同一 Handler 同时有提交和 no-op 输出时，可在 output Schema 校验后按输出动态选择策略，仅真正提交的结果允许完成获胜。这类 Handler 一旦返回已提交结果，随后抵达的取消不能再把 Task 标成 cancelled；租约丢失或关闭信号仍不允许越权完成。

## 可观测性

结构化日志使用 taskId/taskType/attempt，不输出完整 payload。查询提供队列计数、最老等待时长、失败分类和运行租约。

来源同步任务详情只投影经过白名单校验的业务字段。应用层从任务 payload 读取 `sourceId` 和触发方式，数据库读模型关联公司、逻辑招聘渠道和物理来源；同步运行按同一来源且开始时间落在任务执行窗口内选择最近一次，从而兼容历史任务和同一任务的自动重试。页面展示发现、入库、过滤和生命周期统计，不返回原始 payload、来源配置或采集响应。

`source.job-detail` 保持一职位一任务的执行模型，以保留独立并发键、自动重试和失败隔离。诊断读模型使用 payload 中已有的 `(sourceId, runId)` 作为批次键，在数据库中先聚合再与普通任务合并排序和分页；因此任务表和 Worker 无需新增父任务。批次状态按“运行中、等待、失败、全部取消、成功”优先级汇总，并展示各子状态数量。批次行使用同步运行 ID 作为稳定展示 ID，不提供会误作用于单个子任务的取消/重试按钮。

任务错误可显式声明一次任务级重试覆盖。职位详情 Handler 对 `parse_changed` 保留原分类与具体安全诊断，同时声明可重试；Worker 将该覆盖交给现有 `RetryPolicy`，因此只在详情任务的尝试次数未耗尽时退避重试，其他任务的同类错误仍立即终止。

## 测试

真实 SQLite + 伪时钟测试领取竞争、租约恢复、调度幂等和关闭；假 Handler 测试重试与取消。所有等待通过伪时钟推进，不使用长 sleep。
