# ADR-0011：以通用事件和文件—实体模型收敛专用表

> 状态：Superseded by ADR-0012
> 日期：2026-08-30

## 背景

数据库逐步出现四类事件专用表和三类文档/物理文件包装表。部分表只有写入没有读取，部分字段与 `agent_runs` 或物理 Artifact 完整重复；继续按功能增加表会放大迁移、删除、备份和诊断成本。

Cloudreve 将用户看到的逻辑 File 与不可变 File Blob 分离：文件可以拥有多个 Blob 版本，Blob 可被多个文件共享，失去引用的 Blob 再异步清理。该所有权模型适合本项目本地文件去重和文档版本共存，但其目录、权限、配额和云存储抽象不属于本项目。

## 决策

1. 新增通用 `events`，用流类型、流 ID、序号、事件类型、JSON 正文和发生时间保存追加式诊断/审计事实。它不替代领域当前态。
2. 新增 `files`、`file_entities`、`file_entity_versions`：逻辑文件拥有最多五个实体版本，物理实体按内容哈希共享。
3. 删除 `job_status_events`、`operation_audit_events`、`sync_item_failures`、`agent_tool_calls`，保留数据迁入 `events`。
4. 删除 `file_artifacts`、`resume_documents`、`experience_documents`，其数据迁入通用文件模型；面经经历和问题仍是领域实体表。
5. 删除 `resume_polish_suggestions`，以 `agent_runs.output_json` 为结果事实，`tasks` 负责结果定位和执行状态。

## 理由

- 事件按主体流有相同的写入、排序、诊断和保留需求，专用表没有额外约束收益。
- 逻辑文件与物理内容生命周期不同；分离后内容去重、版本共存和安全删除都能由清晰引用关系表达。
- 五版本限制可由关联表的版本号约束直接执行，不需要按文档类型复制表或触发器。
- 面经、匹配结果等真正的领域实体仍保留专用表，避免把通用 JSON 变成没有约束的万能存储。

## 后果

- Repository 查询需要连接通用文件表；删除和清理必须以实体引用数判断物理文件所有权。
- 通用事件正文必须在写入和读取边界按事件类型校验，数据库只保证流顺序和唯一性。
- 达到五个文件内容版本时写入会失败；自动淘汰策略必须另立规格，不能静默覆盖。
- 迁移需要重建四张带旧外键的表，但可在复制和校验完成后再删除旧表，无需丢弃用户数据。

## 参考

- Cloudreve Concepts: <https://docs.cloudreve.org/en/usage/concept>
