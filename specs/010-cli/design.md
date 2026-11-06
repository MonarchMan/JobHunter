# 010 CLI 设计

CLI 与 Web 按数据目录互斥，任务运维通过 list/show/retry/cancel 完成；不保留 task service status/stop/restart。执行命令等待目标工作流，宿主退出时回收全部线程。

> 状态：Ready

> 中央调度服务已接入，实际数据迁移按整体三阶段计划执行，见 [ADR-0062](../../docs/adr/0062-central-task-scheduler.md)；验收记录见 003 规格的 tasks.md。

## 技术与结构

使用 Commander.js 定义命令，`apps/cli` 只负责参数 Schema、应用容器装配、Renderer 和退出码映射。

```text
apps/cli/src/
├─ commands/
├─ renderers/human.ts
├─ renderers/json.ts
├─ exit-codes.ts
├─ container.ts
└─ main.ts
```

所有命令处理器返回 `CommandResult<T>`；人类与 JSON renderer 使用同一 DTO。错误经过 ApplicationError code 映射，未知异常记录 correlation ID 后返回 1。

## 分页与等待

job/task list 使用 `--cursor`、`--limit`；人类模式可显示 next cursor，不实现隐式无限滚动。`--wait` 使用递增轮询间隔并响应 Ctrl+C；Ctrl+C 只停止等待，只有 `task cancel` 才取消后台任务。

## 导出

支持 JSON 和 CSV；文件由 Artifact/Export 用例原子写入。CSV 使用 UTF-8 BOM 选项以兼容本地表格工具，字段及数组序列化在规格化 exporter 中定义。

## 测试

- 命令解析单元测试。
- 应用服务 fake 的快照测试。
- 临时 data root 的端到端命令测试，直接调用 main 并捕获 stdout/stderr，不依赖 shell 文本解析。
- Windows 路径与中文文件名 fixture。

## 中央任务服务接入（待实现）

CLI 在主线程持有调度器和动态线程池，通过根任务及递归父子关联限定领取范围；不触发周期或无关积压。默认等待执行结果，Ctrl+C 停止执行但保留检查点恢复。迁移与恢复沿用数据目录独占锁。

## 单宿主运行约束（ADR-0065）

同一数据目录 Web/CLI 互斥；主线程统一调度，业务 Handler 由有界动态线程池执行。Web 启动器拥有运行时，Next 只使用受限命令桥。CLI 不启动周期或消费无关历史任务，执行命令等待目标工作流；关闭宿主停止执行，强杀后由下次启动恢复。此约定替代原独立后台服务和退出继续运行的描述。详见 [003 设计](../003-task-worker/design.md)。
