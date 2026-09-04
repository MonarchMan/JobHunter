# 012 配置、可观测性与运维设计

> 状态：Implemented

## 配置

`packages/application/config` 定义 BootstrapConfig、AppConfig 和唯一的运行时配置加载器。CLI、Web 与 Worker 都显式传入工作区根目录；加载器先读取 `<workspaceRoot>/.env`，再以进程环境覆盖同名值，随后执行两阶段解析：第一阶段只从 CLI、合并环境和内置默认值解析 dataRoot/configPath；第二阶段从该路径加载非敏感文件，再合并普通配置。这样配置结果不受进程当前工作目录影响，也不依赖 Next、tsx 或 Shell 各自的环境文件行为。

配置文件不得改变自己的路径或 dataRoot，避免循环解析。环境变量使用 `JOBHUNTER_` 前缀；秘密字段使用 `SecretString` 包装，禁止默认 `toString/toJSON`。本地配置文件默认 `<dataRoot>/config.json`，只允许 Settings Registry 中的非敏感字段。显式进程环境继续高于 `.env`，CLI 临时参数继续拥有最高优先级。

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
