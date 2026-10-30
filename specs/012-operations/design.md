# 012 配置、可观测性与运维设计

> 状态：Implemented

SQLite 维护由应用服务负责检查频率与阈值，数据库维护仓储负责检查、互斥、备份与空间回收。Worker 调度循环通过可选周期工作端口驱动检查，持久化 next_check_at 防止重启补发，独立子进程执行同步 SQLite 重操作。

维护仓储在占用检查时刻前先回收死亡持有者，再检查运行中任务和已到期待领取任务；存在业务工作时不推进 `next_check_at`，由主 Worker 的分钟级轻量轮询在空闲后重试。这样不仅 VACUUM/TRUNCATE，可能写入统计表的日常 `PRAGMA optimize` 也不会主动与来源同步争抢写锁。检查后的极短竞态仍由 Worker 装配层统一识别 SQLite busy/locked 与维护写保护，并交给任务租约恢复。

database_maintenance 单例保存检查摘要与 owner_pid。所有标准连接安装临时写保护触发器，活跃维护进程存在时拒绝业务写入；维护连接绕开该保护，仅在 BEGIN IMMEDIATE 中检查任务和调度并取得维护标记。检查与标记受同一写事务保护，既有写事务先完成，新写事务被拒绝。进程死亡后保护不再生效，下次检查回收遗留审计；Worker 领取和调度提交在同一事务中识别标记并跳过。

正常 PASSIVE 检查不等待读者。TRUNCATE 使用短锁等待，繁忙退出；VACUUM 前按主库三倍加 64 MiB 校验剩余空间，使用 backup API，成功后完整性与外键校验，通过校验的维护备份保留最近两份。备份是数据库快照，不替代包含附件的全量应用备份。维护失败不自动恢复快照覆盖当前库。

## 配置

`packages/application/config` 定义 BootstrapConfig、AppConfig 和唯一的运行时配置加载器。CLI、Web 与 Worker 显式传入工作区根目录；加载器仅读取 `<workspaceRoot>/.env`，以进程环境覆盖同名值，再应用 CLI 临时参数和内置默认值。先解析 dataRoot 与邮箱数据路径，再校验普通参数，不再读取 JSON 运行配置。配置结果不受进程当前工作目录影响。

`.env.example` 是唯一运行配置模板；`init` 仅初始化运行数据。模板中的用户配置参数不使用项目前缀，模型连接统一使用 `BASE_URL`、`MODEL`、`API_KEY`。`BASE_URL` 默认 `https://api.openai.com/v1`，根据主机标签或路径段中的独立 `anthropic` 标识推断协议。秘密字段使用 `SecretString` 包装，禁止隐式回显。

Worker 参数使用 `WORKER_POLL_INTERVAL_MS`、`MAX_CONCURRENT_NETWORK_TASKS`、`TASK_TYPE_CONCURRENCY`（JSON 对象字符串）。平台统一间隔使用 `PLATFORM_REQUEST_INTERVAL_MS`，追加 `_BOSS`、`_ZHILIAN`、`_51JOB`、`_LIEPIN` 分别覆盖对应平台。邮箱账号、同步游标和加密凭据属于运行数据，继续独立存储。

## 日志

Pino logger 通过项目 `SafeLogger` 端口包装，调用方传结构化字段。Redactor 按键名、类型和业务 DTO 白名单处理；未知 error response 只记录状态、大小、哈希和已允许摘要。

## Doctor/Health

检查分层：

- required：运行时、目录、SQLite、迁移、注册表。
- degraded：可选模型配置、暂时不健康来源。
- informational：版本和最近统计。

来源 health check 仅在显式 `--online` 时调用最小请求；默认 doctor 完全离线。

## 备份、恢复和清理

Operations 服务复用 ArtifactStore 和数据库 backup adapter。备份先生成 SQLite 快照，再从快照中的 Artifact 引用生成清单和复制文件；恢复必须证明其他进程已停止并取得独占数据库连接。所有危险操作先构造 `OperationPlan { targets, counts, bytes, warnings, confirmationToken }`；确认调用必须回传包含计划哈希的短期 token，防止目标在预览后变化。

孤立文件清理同时要求“当前数据库无引用”和“文件年龄超过 safetyWindow”，默认 24 小时；这避免删除文件落盘与数据库登记之间的短暂窗口。清理数据库记录和文件时先按引用关系生成固定计划，失败可重跑且不会越过 data root。

Windows 路径使用 `Resolve-Path` 等价的应用逻辑核验：目标必须位于配置 data root 或显式 backup root，且不能等于根目录本身。旧目录通过时间戳重命名保留，用户显式清理。

## 测试

表驱动配置优先级、跨启动目录的一致配置加载、日志泄漏扫描、临时目录备份恢复、篡改清单、根路径拒绝和 dry-run/confirm token 失效测试。
