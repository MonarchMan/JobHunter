# 022 存储与事件模型收敛设计

> 状态：In Progress

## 1. 审计方法与结论

表的保留条件至少满足一项：承担不可重建事实、被稳定读取、提供不可替代的数据库约束，或是性能上有明确收益的物化结果。仅有单点写入、可从其他表完整重建、或只是给一种文档复制通用文件字段的表必须合并。

| 结论 | 表                                                                                      | 理由                                                                     |
| ---- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 保留 | `companies`、`source_channels`、`job_sources`、`sync_runs`                              | 来源目录与同步运行的稳定事实和约束                                       |
| 保留 | `source_job_details`、`jobs`、`job_revisions`、`job_observations`、`sync_seen_jobs`     | 可过期详情缓存、当前态、标准化版本、观测和有界同步工作集各自不可替代     |
| 保留 | `candidate_profiles`、`profile_versions`                                                | 画像聚合与不可变版本                                                     |
| 保留 | `agent_runs`、`job_enrichments`、`match_rulesets`、`match_results`、`match_advices`     | Agent 执行事实及有稳定查询语义的推导结果                                 |
| 保留 | `tasks`、`schedules`、`application_settings`                                            | 通用基础设施                                                             |
| 保留 | 项目拷打七表                                                                            | 分别承载项目快照、聚合、会话、问答修订、知识证据和覆盖状态，均有读写链路 |
| 保留 | `interview_experiences`、`interview_question_entries`                                   | 它们是面经领域实体，不是文件元数据包装                                   |
| 合并 | `job_status_events`、`operation_audit_events`、`sync_item_failures`、`agent_tool_calls` | 都是追加式、按主体流查询的事件                                           |
| 合并 | `file_artifacts`、`resume_documents`、`experience_documents`                            | 逻辑文件、物理内容和解析结果重复且绑定文档种类                           |
| 删除 | `resume_polish_suggestions`                                                             | 与 `agent_runs.output_json` 完整重复；任务已有结果定位信息               |
| 删除 | `raw_job_records`                                                                       | 完整原始响应没有稳定读取价值；修订只需来源哈希、URL 和标准化快照         |
| 删除 | `jobs_fts` 及内部对象                                                                   | 当前数据规模使用 `jobs` 上的转义 `LIKE` 足够，避免虚表和同步触发器       |

迁移后从 37 张业务表减少为 32 张：删除九张、新增四张。FTS 虚表及其内部表不计入业务表数。

## 2. 通用事件

`events` 不是全系统事件溯源。领域表继续保存当前态；这里只保存需要审计、诊断或时间线展示的不可变事实。

```text
events
├─ id                  UUIDv7，主键
├─ stream_type         job | sync_run | agent_run | operation
├─ stream_id           领域主体 ID 或不可逆主体哈希
├─ sequence_no         流内从 1 开始的序号
├─ event_type          命名空间事件名
├─ payload_json        事件专属、已脱敏 JSON
└─ occurred_at         UTC epoch milliseconds
```

唯一约束为 `(stream_type, stream_id, sequence_no)`；索引覆盖流读取和按事件类型/时间诊断。事件映射如下：

| 旧表                     | `stream_type` | `event_type`          | payload                               |
| ------------------------ | ------------- | --------------------- | ------------------------------------- |
| `job_status_events`      | `job`         | `job.status.changed`  | sync run、前后状态、原因、证据        |
| `sync_item_failures`     | `sync_run`    | `sync.item.failed`    | 来源、外部职位、来源 URL、阶段和错误  |
| `agent_tool_calls`       | `agent_run`   | `agent.tool.finished` | 工具、状态、输入/输出摘要、耗时、错误 |
| `operation_audit_events` | `operation`   | 原事件类型            | 主体哈希和详情                        |

Repository 在现有短事务内追加事件。同步失败的流内序号在单写事务内取当前最大值加一；Agent 工具调用沿用 Runner 已生成的序号；职位与操作迁移按时间和 ID 稳定排序生成序号。

## 3. 文件—实体模型

设计借鉴 Cloudreve 的 `File` 与不可变 `File Blob` 分离：逻辑文件可拥有多个内容版本，物理内容可被多个逻辑文件共享，失去引用的物理内容异步清理。这里不复制网盘的目录、权限和存储策略，只采用所有权分离。

```text
files 1 ── 1..5 file_entity_mappings 5..1 ── 1 entities
  │                     │                         │
  │ 逻辑名称/种类/状态   │ 版本与解析结果          │ 哈希/路径/大小/媒体类型
  └─────────────────────┴─────────────────────────┘
```

### `files`

- `id`、`kind`、`name`、`state`、`revision`
- `properties_json`：只放业务低频元数据，例如面经来源方式、模板版本、警告、接受时间
- `created_at`、`updated_at`、`deleted_at`

### `entities`

- `id`、唯一 `relative_path`、`media_type`、`sha256`、`byte_size`
- 内容不可变；活动实体按 SHA-256 唯一，因此相同字节只保存一次
- `created_at`、`deleted_at`

### `file_entity_mappings`

- 复合主键 `(file_id, version_no)`，`CHECK version_no BETWEEN 1 AND 5`
- `(file_id, entity_id)` 唯一，避免一个物理实体在同一逻辑文件下伪装成多个内容版本
- `parser_version`、`parse_status`、`extracted_text`、`normalized_text`、`error_summary`
- `metadata_json` 保存与该内容/解析版本绑定的低频字段

最多五个版本由数据库约束直接保证，不依赖应用计数。当前导入用例创建版本 1；后续替换文件时显式追加版本，达到上限前必须由用户删除旧版本，本规格不自动覆盖。

## 4. 业务映射

| 业务         | 逻辑文件 kind          | 逻辑文件 ID                                   | 引用位置                            |
| ------------ | ---------------------- | --------------------------------------------- | ----------------------------------- |
| 简历         | `resume`               | 原 `resume_documents.id`                      | `profile_versions.resume_file_id`   |
| 个人面经     | `interview_experience` | 原 `experience_documents.id`                  | `interview_experiences.file_id`     |
| 项目准备文档 | `project_notebook`     | 原 `project_dossiers.id`；兼容迁移允许独立 ID | `project_dossiers.notebook_file_id` |

Repository 的公开领域术语可以继续使用“简历文档”和“面经文档”，但 SQLite 不再为每类文档建包装表。物理路径只通过实体读取器暴露，领域记录不得把路径当所有权 ID。

## 5. 迁移顺序

迁移 `0019_storage_event_convergence.sql`：

1. 创建四张通用表和索引。
2. 从非原始职位用途的 `file_artifacts` 复制不可变实体。
3. 依次为简历、面经和项目笔记创建逻辑文件及映射；再为非 `raw_job` 且无人引用的旧 Artifact 创建兼容逻辑文件。
4. 把四类旧事件按稳定顺序写入 `events`。
5. 重建 `job_sources`、`job_revisions`、`job_observations`、`profile_versions`、`project_dossiers` 和 `interview_experiences`，移除冗余列并切换引用。
6. 删除九张旧业务表、FTS5 虚表及其触发器，并运行迁移集成测试的 `foreign_key_check`、行数和可读性断言。

SQLite 表重建期间由迁移连接临时关闭外键执行，切换完成后恢复并立即检查。生产启动仍保持 `foreign_keys = ON`。

## 6. 应用改动

- `ArtifactStore.put` 创建逻辑文件并对物理实体按 SHA-256 去重，返回逻辑文件 ID 和实体 ID。
- 简历、面经和项目笔记 Repository 从通用文件表读取当前版本。
- 同步链路不再写原始职位文件或记录；标准化修订直接记录 `source_payload_hash` 和 `source_url`，观察引用修订。
- 删除服务按实体引用计数决定是否隔离；清理只删除无活动文件版本引用的实体。
- Web 诊断从 `events` 恢复 Agent 工具调用时间线。
- 简历润色 Handler 不再保存 Suggestion；Service 通过 Task 输出的 `agentRunId` 读取并校验 Agent 输出。

## 7. 验证

- Schema/迁移：新表、旧表与 FTS 对象不存在、迁移只执行一次、外键、共享实体和五版本上限。
- Repository：简历/面经 CRUD、删除共享保护和项目笔记读取。
- 事件：职位状态、同步失败、工具调用和删除审计的写入与诊断读取。
- 应用：简历润色成功、缓存命中、任务结果丢失/Agent 输出无效的失败表现。
- 运维：backup、cleanup、doctor 对新模型的集成测试。
