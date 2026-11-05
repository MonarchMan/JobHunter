# 010 CLI 设计

中央服务维护使用 `task service status|stop|restart` 子命令。status 只探测；stop 等待服务回收执行器并释放单实例锁，配置已修改时也可显式停止旧实例；restart 先完成停止再按当前配置启动。普通任务提交遇到配置冲突仍直接报错，不能自动替换运行中的实例。上述命令不创建独立 worker 入口。

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

CLI 使用 common TaskClient 连接同数据目录中央服务；冷启动走统一启动协调协议，不创建领取循环。--wait 只订阅状态，退出和 Ctrl+C 不取消后台任务。主动取消使用任务取消命令；初始化、迁移和恢复须协调服务维护状态。服务协议或配置不兼容返回明确诊断。
