# 002 SQLite 持久化设计

> 状态：Implemented

## 技术选择

- 普通连接比较迁移前后数据库变化，仅新建或实际迁移时执行全库检查；提供显式完整检查选项供恢复验证使用。
- 页码关键词查询采用 MATERIALIZED CTE，计数与分页共享不含正文的结果集；空结果通过 LEFT JOIN 返回计数。游标与无关键词查询保持原路径。

- Drizzle ORM 管理 Schema 和迁移。
- `better-sqlite3` 提供同步、短小、可预测的 SQLite 访问。
- Repository 方法保持同步数据库调用，但应用用例可以是 async 以编排外部端口。
- 文件位于配置的 data root，默认 `var/`。

## 组件

```text
packages/db/
├─ schema/
├─ migrations/
├─ repositories/
├─ transaction.ts
├─ connection.ts
├─ health.ts
└─ index.ts
```

`DbSession` 是应用层事务端口的实现。应用层通过 `UnitOfWork.run(fn)` 获得绑定同一连接的 Repository 集合；回调必须是同步数据库阶段，不接受外部 Promise。

### 系统设置

`application_settings` 继续由 `SqliteSettingsStore` 实现。设置 key 必须先在 Registry
中声明并通过 Zod Schema 校验；应用层只依赖设置 Repository 端口，不直接依赖 SQLite。
`matching.jobUnderstanding` 的默认值和迁移值均为 `{ "enabled": false }`。同步 Worker
在每次同步开始时读取该设置，作为是否创建 `job.enrich` 任务的全局最终开关。

## 初始化

连接顺序：解析绝对 data root → 创建目录 → 打开库 → 设置 PRAGMA → 检查 SQLite/FTS5 → 执行迁移 → foreign_key_check。busy timeout 默认 5000ms，可配置。

文件服务使用经过解析的绝对路径检查 `relative(target, root)` 不以 `..` 开头且不是绝对路径。临时文件与目标位于同一目录以保证原子改名。

## 查询

`JobQueryRepository` 接受经过 Zod 校验的 filter DTO 和 cursor。稳定排序为用户排序字段 + `job.id`，使用游标分页，不使用大 offset。全文搜索先命中 FTS rowid/ID，再与结构化筛选连接。

## 备份恢复

备份通过 SQLite Online Backup API 先生成数据库快照，再打开该快照查询全部被引用 Artifact；只复制这份清单中的不可变文件并验证 SHA-256，因此在线写入发生在快照之后也不会破坏一致性。备份不需要暂停 Worker，但不能复制数据库快照之外的“当前目录全集”。

恢复必须在 preflight 中证明 CLI 之外的 Worker/Web 已停止且数据库可取得独占连接。恢复内容先写入新的临时 data root，验证 manifest、`integrity_check`、`foreign_key_check` 和文件哈希后再切换。Windows 无法原子替换非空目录时，先把当前 data root 重命名为带时间戳旧目录，再把临时目录改为正式目录；任一步失败都保留旧目录供显式回滚。

## 测试

每个 Repository 运行共享契约测试；集成测试使用独立临时目录和真实 SQLite，不 mock SQL。迁移测试保留最小上一版 fixture database。
