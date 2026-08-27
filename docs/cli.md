# JobHunter CLI

CLI 是 Web 管理台之前的完整个人使用入口。默认输出中文人类可读文本；加入 `--json` 后，stdout 只包含稳定 JSON envelope，等待提示和运行进度写入 stderr。

## 初始化与基本约定

```powershell
jh --data-root "D:\JobHunter 数据" init
jh --data-root "D:\JobHunter 数据" doctor
```

全局参数必须放在子命令之前：

- `--data-root <path>`：本地数据目录，默认 `./var`。
- `--config <path>`：非敏感配置文件，默认 `<data-root>/config.json`。
- `--json`：输出机器 JSON。

路径参数既接受绝对路径，也接受相对当前工作目录的路径。在 PowerShell 中，包含空格的路径需要加双引号；POSIX shell 同样可使用双引号。

## 常用工作流

```powershell
# 导入简历并得到画像提取 task ID
jh resume import "docs/resumes/nowcoder_1787802316450.jpeg"

# 在另一个终端启动 Worker
jh worker start

# 同步官网并等待结果
jh source sync tencent-social --wait

# 为单个具体职位运行确定性匹配
jh match score <jobId> --wait
jh match list <profileId> --include-stale --limit 20
jh match show <matchResultId>

# 导出当前可投职位
jh job export "exports/职位.csv" --format csv --bom
```

`source sync`、简历画像提取和 `match score` 默认只入队。只有显式提供 `--wait` 才轮询；等待期间按 Ctrl+C 只停止本地等待，不会取消后台任务。系统不会提供或执行全量职位批量匹配。

## 画像人工维护

`profile set` 的字段使用规范 JSON Pointer，值必须是合法 JSON：

```powershell
jh profile set <profileId> /preferences/locations '["北京","上海"]'
jh profile lock <profileId> /preferences/locations
jh profile history <profileId>
jh profile unlock <profileId> /preferences/locations
```

每次有效修正、锁定或解锁都会创建不可变新版本。

## 备份与危险恢复

备份目录必须位于 data root 外部：

```powershell
jh backup create "D:\JobHunter Backups\backup-001"
jh backup verify "D:\JobHunter Backups\backup-001"
jh backup restore "D:\JobHunter Backups\backup-001"
```

`backup restore` 默认只执行 dry-run，不修改文件。它会返回绑定备份哈希、目标目录指纹和过期时间的确认令牌。停止 Worker、Web 和其他 CLI 后，原样回传令牌才会执行：

```powershell
jh backup restore "D:\JobHunter Backups\backup-001" --confirm <dryRunToken>
```

旧数据目录会被重命名保留，不会在恢复成功后立即删除。

## JSON 与退出码

```powershell
jh --json schema
jh --json job list --limit 20
```

Schema 同时保存在 [`docs/schemas/cli-output.schema.json`](schemas/cli-output.schema.json)。成功 envelope 为 `{ "ok": true, "data": ... }`；失败 envelope 为 `{ "ok": false, "error": { "code", "message", "details" } }`。

| 退出码 | 含义                             |
| -----: | -------------------------------- |
|      0 | 成功                             |
|      1 | 未分类内部错误或完整性校验失败   |
|      2 | 用法、配置或危险操作确认被拒绝   |
|      3 | 指定资源不存在                   |
|      4 | 部分成功、来源退化或主动中断等待 |
|      5 | 后台任务达到最终失败或取消状态   |
