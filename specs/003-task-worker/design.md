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

Cron 解析使用 `cron-parser` 和 IANA timezone；计算结果统一转换为 UTC epoch milliseconds 后持久化。夏令时重复/跳过时以库的时区语义为准，并用 occurrence UTC 时间参与幂等键。

重试由 `RetryPolicy` 产生 `availableAt`；测试注入确定性随机数。手动 retry 创建新任务幂等键后缀并关联原失败任务，保留审计链。

## 取消

pending 直接转 cancelled。running 写入取消请求并通过当前进程内 AbortController 立即通知；跨进程 Worker 在心跳时检查取消。Handler 必须在分页、模型调用和批处理边界检查信号。

## 可观测性

结构化日志使用 taskId/taskType/attempt，不输出完整 payload。查询提供队列计数、最老等待时长、失败分类和运行租约。

## 测试

真实 SQLite + 伪时钟测试领取竞争、租约恢复、调度幂等和关闭；假 Handler 测试重试与取消。所有等待通过伪时钟推进，不使用长 sleep。
