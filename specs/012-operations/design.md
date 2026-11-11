# 012 配置、可观测性与运维设计

异常分类优先于诊断原因：线程存储标记与宿主锁忙检测共同尊重不可重试 Agent 边界。未知错误使用固定公开摘要，原始错误仅经 cause 脱敏；文本凭据脱敏共用于日志和持久化摘要，覆盖带引号与转义的 JSON 值。模型失败收尾采用聚合原因保留原始调用和账本故障，外层保持账本不可重试分类及请求身份。

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

## 日志架构升级（ADR-0068）

1、common/logging 提供纯日志契约、异步上下文、脱敏、Pino 输出、线程事件通道与只读查询。宿主拥有唯一任务文件 sink，线程使用专用 MessagePort，按确认额度限制在途消息，关闭有界等待并统计未发送事件。通道只运输脱敏 JSON，不复用任务控制协议。
2、入口装配借用 logger，借用者不能关闭根 sink。工作线程退出前排空日志；宿主在线程退出后关闭文件。Next 请求进程每进程独立文件，通过全局单例避免开发热重载重复写入者，不共享 jobhunter.log 的轮转。
3、日志 envelope 含 event、time、level、pid、threadId、hostRunId；AsyncLocalStorage 隔离任务上下文，绑定 taskId/taskType/attempt/parentTaskId。Agent 事件附加 agentRunId，模型请求事件附加 modelRequestId，继续复用现有账本。
4、错误先提取安全白名单再脱敏，保留有限 stack/cause/code/status；限制深度、条目、文本和事件字节数，禁用级别先短路。未知响应只保存类型/状态/有界摘要。URL 移除凭据、query 和 fragment。序列化及输出失败只降级，不把日志异常传播给业务。
5、LOG_LEVEL 控制文件；CONSOLE_LOG_LEVEL 默认 warn，LOG_FORMAT 为 auto/pretty/json。pretty 只渲染摘要与关联 ID，不在控制台打印整份异常；自动模式在非 TTY 输出 JSON。高频 queue_busy 告警窗口聚合；worker.runtime 降为 debug。
6、Web errorResponse 记录脱敏异常和 correlationId，请求对象存在时记录 method/path；500/503 响应不暴露内部异常。浏览器调试改用作用域 logger，禁止直接输出原始 URL。
7、CLI logs 提供 task/correlation 筛选与 JSON 输出（重定向即脱敏导出）。查询固定 dataRoot/logs 下受控文件名，拒绝符号链接、限制单文件读取与总扫描量、结果数和损坏行；时间排序，返回截断信息。保持现有任务/Agent/模型账本为业务状态事实来源。

不迁移数据库、不清理旧日志。旧 JSON 行可读取；新增事件格式以 schemaVersion 标识。Web 每个进程文件沿用单文件与轮转数量上限；本轮不自动删除历史进程文件，用户可按需归档。跨进程查询最多枚举 4096 个目录项、扫描 64 个文件和 32 MiB，并显式返回截断标记。

## 排障入口

错误传播采用公开安全摘要与内部 cause 分离：存储错误重建对象的 cause 指向线程诊断快照；日志白名单包含有界聚合子异常和安全 Schema issue 路径/代码。32 KiB 字段预算先移除普通字段，再缩减错误树，始终保留错误类型与消息；不把原始模型正文或校验输入写入日志。

- `jh logs --task <taskId>`：查看任务及其 Agent/模型诊断时间线。
- `jh logs --correlation <correlationId>`：定位 Web 错误响应对应的内部异常。
- `jh logs --agent <agentRunId>` / `jh logs --model-request <requestId>`：关联已有运行/请求账本；模型详细事件须在 debug 下采集。
- `jh --json logs --task <taskId> --limit 1000 > diagnostics.json`：导出重新脱敏的事件及扫描限制。
- `jh --verbose <command>`：临时提升文件与控制台至 debug；`jh --quiet <command>`：控制台仅显示 error，文件保留原级别。

控制台格式由 `LOG_FORMAT=auto|pretty|json` 指定。默认 TTY 使用可读文本，非 TTY 使用 JSON。文本以 ` - ` 分隔秒级 UTC 时间、英文级别（debug、info、warn、error）、事件摘要及各关联字段。`CONSOLE_LOG_LEVEL` 默认 warn，`LOG_LEVEL` 默认 info。浏览器详细事件还受 `JOBHUNTER_BROWSER_DEBUG=1` 控制，不绕过日志级别和脱敏。

## 测试类型检查

根 TypeScript 项目定义无输出检查配置，ESLint 复用其严格检查与模块解析选项。根项目纳入各模块和应用的测试文件，保留生产构建的项目引用及各包输出边界。pnpm typecheck 同时检查生产构建与测试，编辑器由根项目接管不属于生产 include 的测试文件，避免推断项目使用不同的模块解析。测试中的画像、仓储、任务上下文和外部协议夹具遵循当前公开契约。
