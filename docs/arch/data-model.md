# 数据模型与 SQLite 表设计

> 状态：Proposed
> 版本：2.0.0
> 日期：2026-08-30
> 上位文档：[总体架构](./overall-arch.md)

## 1. 目的、范围与设计目标

本文档定义 JobHunter 的目标 SQLite 数据模型，是 Drizzle Schema、迁移、Repository、清理、备份和集成测试的共同依据。本文只描述业务表；SQLite 自身的 `sqlite_*`、Drizzle 迁移表等内部对象不属于业务数据模型。

设计优先级如下：

1. 只保存产品确实读取、约束或无法合理重建的数据。
2. 领域事实使用有外键和约束的专用表，不能把所有业务数据塞进通用 JSON。
3. 同类基础设施统一建模：追加式记录使用通用事件，文档使用逻辑文件—物理实体模型。
4. 当前态与不可变历史分离，模型输出不得覆盖来源事实或用户事实。
5. 数据库事务短小、边界明确；网络、模型和文件解析不进入事务。
6. 本地单用户场景以简单、可恢复、易迁移为先，不为尚未出现的规模预建复杂索引。

本版本明确删除：

- 全部 FTS5 对象：`jobs_fts`、其 shadow tables 及三个同步触发器；关键词搜索直接查询 `jobs`。
- `raw_job_records`；系统不再归档官网完整原始响应，也不承诺重放历史原始数据。
- 按文档类型重复建设的 `resume_documents`、`experience_documents`。
- 事件专用表 `job_status_events`、`sync_item_failures`、`agent_tool_calls`、`operation_audit_events`。
- 与 `agent_runs.output_json` 重复的 `resume_polish_suggestions`。
- 同时混合逻辑文件和物理内容的 `file_artifacts`。

## 2. 通用数据设计约定

### 2.1 标识、类型与命名

- 业务主键使用应用层生成的 UUIDv7，SQLite 物理类型为 `TEXT`；关联表可以使用复合主键。
- 时间使用 Unix epoch milliseconds 的 `INTEGER`，应用层统一按 UTC 解释；面向用户的日期可使用受格式约束的 `YYYY-MM-DD` 文本。
- 布尔值使用 `INTEGER NOT NULL CHECK (value IN (0, 1))`。
- 封闭枚举使用 `TEXT + CHECK`；可扩展注册键使用 `TEXT`，由应用 Registry 和运行时 Schema 校验。
- 表名、列名使用 `snake_case`；外键统一为 `<entity>_id`。
- 金额使用最小整数单位；估算模型成本使用 `estimated_cost_micros`，不使用浮点货币。
- 哈希默认使用 64 位十六进制 SHA-256 文本，并添加长度或格式约束。

### 2.2 当前态、版本、观察与推导

数据按语义分为四类：

| 类型       | 例子                                                | 更新规则                     |
| ---------- | --------------------------------------------------- | ---------------------------- |
| 当前态     | `jobs`、`candidate_profiles`                        | 原地更新，服务主要查询入口   |
| 不可变版本 | `job_revisions`、`profile_versions`                 | 只追加，不静默覆盖           |
| 观察与事件 | `job_observations`、`events`                        | 只追加或按明确保留策略清理   |
| 推导结果   | `job_enrichments`、`match_results`、`match_advices` | 引用不可变输入，绝不反写事实 |

相同有效输入必须用稳定哈希或唯一约束实现幂等。只有内容实际变化时才产生新版本；重复观察不制造新版本。

### 2.3 JSON 字段

JSON 使用 `TEXT` 保存，只适用于：

- 有明确 Schema 的版本化快照；
- 低频、整体读取的值对象；
- 不参与主要过滤、连接和唯一约束的扩展字段；
- 不同事件类型的负载。

所有 JSON 在应用边界使用 Zod 校验，写入前按稳定键序列化，读取后在使用边界再次校验。需要经常过滤、排序、连接或建立约束的字段必须提升为普通列。

JSON 中不得保存模型密钥、认证 Cookie、完整简历正文的日志副本或未脱敏错误堆栈。

### 2.4 通用事件模型

`events` 只保存需要审计、诊断或时间线展示的追加式事实，不承担完整事件溯源。领域当前态仍由领域表保存。

事件流由 `(stream_type, stream_id)` 标识，`sequence_no` 在流内从 1 递增。建议事件名：

- `job.status.changed`
- `sync.item.failed`
- `agent.tool.finished`
- `resume.deleted`

事件不使用多态外键。删除敏感主体后仍需保留的操作事件，以不可逆主体哈希作为 `stream_id`；普通事件的引用完整性由写入用例和清理测试保证。

事件一经插入不可更新。当前态变化及其对应事件必须在同一个 SQLite 事务中提交。

### 2.5 逻辑文件—物理实体模型

文件分成三层：

```text
files 1 ── 1..5 file_entity_mappings 5..1 ── 1 entities
  │                     │                         │
  │ 逻辑身份和业务状态   │ 版本与解析结果          │ 不可变物理内容
```

- `files` 是业务引用的逻辑文件，例如简历、个人面经来源或项目准备文档。
- `entities` 是真实物理内容，保存哈希、相对路径、MIME 和大小；相同字节可以被多个逻辑文件共享。
- `file_entity_mappings` 将逻辑文件映射到物理内容，并保存与该内容版本绑定的解析结果。
- `version_no` 被限制在 1 到 5，复合主键 `(file_id, version_no)` 因而直接保证每个逻辑文件最多五个实体版本。
- 业务表只引用 `files.id`，不得引用物理路径或把 `entities.id` 当作文档 ID。
- 实体引用数由关联表查询，不持久化 `ref_count`，避免双写一致性。

文件物理写入使用同目录临时文件、哈希校验和原子改名。文件 I/O 在事务外完成；写入成功后再用短事务登记实体、逻辑文件、版本和业务引用。事务失败留下的孤立文件由安全窗口后的清理任务回收。

### 2.6 搜索与索引

目标模型不使用 FTS5。职位关键词搜索在 `jobs.title`、`jobs.department` 和 `jobs.description` 上使用转义后的 `LIKE` 条件；公司、状态、职位分类、发布时间和分数仍使用普通索引。

普通索引只为已有主要查询、外键连接、唯一性或任务领取服务，不为可能的未来查询预建。若真实数据和基准证明关键词查询不可接受，必须通过新 ADR 重新引入全文索引，并把其 shadow tables 明确归类为数据库内部对象。

### 2.7 事务、并发与外部副作用

SQLite 使用 WAL、`foreign_keys = ON` 和有限 `busy_timeout`。默认事务为短事务；任务领取等写竞争路径使用 `BEGIN IMMEDIATE`。

事务规则：

1. HTTP、浏览器访问、模型调用、OCR、PDF/DOCX 解析和普通文件 I/O 不得位于数据库事务内。
2. 当前态和对应不可变版本或事件必须原子提交。
3. 任务领取、心跳、完成、失败、重试和取消通过状态条件与租约字段执行 CAS。
4. 用户可编辑文档使用 `revision` CAS，旧修订不得覆盖新修订。
5. SQLite 与文件系统不能形成一个原子事务；删除采用“先隔离文件、提交数据库、成功后清除；失败则恢复”的补偿流程。
6. 网络或模型结果先在边界完成校验，再开启持久化事务。

### 2.8 外键、删除与保留

- 默认使用 `ON DELETE RESTRICT`。
- 只有明确聚合子记录使用 `CASCADE`，例如 Profile → ProfileVersion、Dossier → DrillSession、Experience → Question。
- 当前态引用的不可变版本不得被普通清理隐式删除。
- 敏感数据删除由专用用例先计算稳定影响快照，再按固定顺序执行。
- 物理实体仅在最后一个 `file_entity_mappings` 引用消失后才能隔离和清除。
- 可重建缓存必须声明保留期限，不能伪装成永久事实。

## 3. 按领域划分的表设计

### 3.1 来源目录与同步

本领域拥有公司、逻辑招聘渠道、可执行物理来源和同步运行状态。官网响应只在内存中完成解析和标准化，不保存完整原始响应。

**事务边界：**创建同步运行单独提交；每个职位的当前态、必要修订、观察、状态事件和本轮已见标记原子提交；同步结束时按批推进缺失状态，单个职位的状态变化和事件必须同事务。网络抓取不在事务中。

#### 3.1.1 `companies`

公司目录和用户筛选入口。

| 列                         | 类型    | 约束                    | 说明             |
| -------------------------- | ------- | ----------------------- | ---------------- |
| `id`                       | TEXT    | PK                      | UUIDv7           |
| `slug`                     | TEXT    | UNIQUE NOT NULL         | 稳定机器标识     |
| `name`                     | TEXT    | NOT NULL                | 标准名称         |
| `aliases_json`             | TEXT    | NOT NULL DEFAULT `'[]'` | 别名数组         |
| `industry`                 | TEXT    | NULL                    | 行业标签         |
| `size_tag`                 | TEXT    | NULL                    | 规模标签         |
| `enabled`                  | INTEGER | NOT NULL CHECK          | 是否参与默认同步 |
| `created_at`、`updated_at` | INTEGER | NOT NULL                | 生命周期时间     |

#### 3.1.2 `source_channels`

公司下稳定、面向用户的逻辑招聘渠道，不保存某个具体官网入口的健康状态。

| 列                         | 类型    | 约束                   | 说明                         |
| -------------------------- | ------- | ---------------------- | ---------------------------- |
| `id`                       | TEXT    | PK                     | UUIDv7                       |
| `company_id`               | TEXT    | FK companies, NOT NULL | 所属公司                     |
| `channel`                  | TEXT    | CHECK                  | `intern`、`campus`、`social` |
| `slug`                     | TEXT    | UNIQUE NOT NULL        | 稳定渠道标识                 |
| `enabled`                  | INTEGER | NOT NULL CHECK         | 渠道总开关                   |
| `support_note`             | TEXT    | NULL                   | 非敏感覆盖或阻断说明         |
| `created_at`、`updated_at` | INTEGER | NOT NULL               | 生命周期时间                 |

唯一约束：`(company_id, channel)`。每家公司恰好拥有三个逻辑渠道由 catalog seed 和集成测试保证。

#### 3.1.3 `job_sources`

可以独立执行、限流、重试和观测的物理官网入口或协议。

| 列                                   | 类型    | 约束                         | 说明                                          |
| ------------------------------------ | ------- | ---------------------------- | --------------------------------------------- |
| `id`                                 | TEXT    | PK                           | UUIDv7                                        |
| `company_id`                         | TEXT    | FK companies, NOT NULL       | 所属公司                                      |
| `channel_id`                         | TEXT    | FK source_channels, NOT NULL | 所属逻辑渠道                                  |
| `slug`                               | TEXT    | UNIQUE NOT NULL              | 来源标识                                      |
| `adapter_key`                        | TEXT    | UNIQUE NOT NULL              | 适配器注册键                                  |
| `coverage_role`                      | TEXT    | CHECK                        | `required`、`supplemental`                    |
| `base_url`                           | TEXT    | NOT NULL                     | 官方入口                                      |
| `config_json`                        | TEXT    | NOT NULL DEFAULT `'{}'`      | 非敏感配置                                    |
| `sync_policy_version`                | TEXT    | NOT NULL                     | 当前策略版本                                  |
| `sync_policy_json`                   | TEXT    | NOT NULL                     | 限速和缺失阈值等策略                          |
| `enabled`                            | INTEGER | NOT NULL CHECK               | 是否启用                                      |
| `support_status`                     | TEXT    | CHECK                        | `experimental`、`supported`、`blocked`        |
| `support_note`                       | TEXT    | NULL                         | 支持限制                                      |
| `health_status`                      | TEXT    | CHECK                        | `unknown`、`healthy`、`degraded`、`unhealthy` |
| `consecutive_failures`               | INTEGER | NOT NULL DEFAULT 0           | 连续失败数                                    |
| `probe_status`                       | TEXT    | NULL                         | 最近探测状态                                  |
| `last_probe_at`                      | INTEGER | NULL                         | 最近探测时间                                  |
| `probe_error_category`               | TEXT    | NULL                         | 探测错误分类                                  |
| `probe_diagnostics_json`             | TEXT    | NOT NULL DEFAULT `'{}'`      | 脱敏探测摘要                                  |
| `last_success_at`、`last_failure_at` | INTEGER | NULL                         | 最近同步结果时间                              |
| `created_at`、`updated_at`           | INTEGER | NOT NULL                     | 生命周期时间                                  |

应用层必须校验来源公司与所属渠道公司一致。索引覆盖 `channel_id`、启用状态和健康查询。

#### 3.1.4 `sync_runs`

一次物理来源同步的运行事实。

| 列                                  | 类型    | 约束                     | 说明                                                     |
| ----------------------------------- | ------- | ------------------------ | -------------------------------------------------------- |
| `id`                                | TEXT    | PK                       | 运行 ID                                                  |
| `source_id`                         | TEXT    | FK job_sources, NOT NULL | 物理来源                                                 |
| `trigger`                           | TEXT    | CHECK                    | `manual`、`schedule`、`retry`                            |
| `status`                            | TEXT    | CHECK                    | `running`、`succeeded`、`partial`、`failed`、`cancelled` |
| `coverage`                          | TEXT    | CHECK                    | `complete`、`partial`、`unknown`                         |
| `adapter_version`                   | TEXT    | NOT NULL                 | 适配器版本                                               |
| `normalizer_version`                | TEXT    | NOT NULL                 | 标准化器版本                                             |
| `sync_policy_version`               | TEXT    | NOT NULL                 | 状态策略版本                                             |
| `source_config_hash`                | TEXT    | NOT NULL                 | 脱敏配置哈希                                             |
| `cursor_in_json`、`cursor_out_json` | TEXT    | NULL                     | 输入和输出游标                                           |
| `stats_json`                        | TEXT    | NOT NULL DEFAULT `'{}'`  | 发现、增改、关闭和失败计数                               |
| `coverage_evidence_json`            | TEXT    | NOT NULL DEFAULT `'{}'`  | 覆盖完整性证据                                           |
| `error_category`、`error_summary`   | TEXT    | NULL                     | 脱敏失败信息                                             |
| `started_at`、`finished_at`         | INTEGER | NOT NULL / NULL          | 运行时间                                                 |

索引：`(source_id, started_at DESC)`、`(status, started_at DESC)`；部分唯一索引 `source_id WHERE status = 'running'` 保证一个来源最多一个运行中同步。

#### 3.1.5 `source_job_details`

延迟详情抓取的可重建缓存，不是原始数据档案。缓存可过期、覆盖或整体删除。

| 列                                | 类型    | 约束                     | 说明                       |
| --------------------------------- | ------- | ------------------------ | -------------------------- |
| `source_id`                       | TEXT    | FK job_sources, NOT NULL | 来源                       |
| `external_job_id`                 | TEXT    | NOT NULL                 | 来源职位 ID                |
| `list_content_hash`               | TEXT    | NOT NULL                 | 触发详情抓取的列表内容哈希 |
| `adapter_version`                 | TEXT    | NOT NULL                 | 产生缓存的适配器版本       |
| `status`                          | TEXT    | CHECK                    | `succeeded`、`failed`      |
| `detail_json`                     | TEXT    | NULL                     | 成功时的短期详情缓存       |
| `error_category`、`error_summary` | TEXT    | NULL                     | 失败摘要                   |
| `fetched_at`                      | INTEGER | NULL                     | 成功抓取时间               |
| `updated_at`                      | INTEGER | NOT NULL                 | 最近更新                   |

复合主键：`(source_id, external_job_id)`。网络请求结束并校验后，以一个短事务覆盖该缓存；不得被 `job_revisions` 当作永久证据引用。

#### 3.1.6 `sync_seen_jobs`

同步运行期间的有界工作集，用于流式记录本轮已观察职位，避免在内存保存来源全部职位。

| 列            | 类型 | 约束                   | 说明       |
| ------------- | ---- | ---------------------- | ---------- |
| `sync_run_id` | TEXT | FK sync_runs, NOT NULL | 同步运行   |
| `job_id`      | TEXT | FK jobs, NOT NULL      | 已观察职位 |

复合主键：`(sync_run_id, job_id)`。与 `job_observations` 在同一个职位写入事务中登记；运行完成或恢复清理后删除，不作为长期历史。

### 3.2 职位事实与生命周期

本领域保存职位当前投影、标准化修订和同步观察。完整官网响应不落库；可追溯性止于来源 URL、来源内容哈希、标准化器版本和标准化快照。

**事务边界：**首次职位写入必须同时创建修订、观察、已见标记和 `job.status.changed` 事件；内容变化必须同时更新当前态并创建修订；内容未变化只创建观察；状态变化必须同时更新 `jobs` 并追加事件。

#### 3.2.1 `jobs`

职位当前标准化投影，是列表、筛选和关键词搜索的主要查询表。

| 列                                  | 类型    | 约束                     | 说明                        |
| ----------------------------------- | ------- | ------------------------ | --------------------------- |
| `id`                                | TEXT    | PK                       | 职位 ID                     |
| `company_id`                        | TEXT    | FK companies, NOT NULL   | 公司                        |
| `source_id`                         | TEXT    | FK job_sources, NOT NULL | 权威物理来源                |
| `external_job_id`                   | TEXT    | NOT NULL                 | 来源稳定 ID 或适配器指纹    |
| `title`                             | TEXT    | NOT NULL                 | 标准化标题                  |
| `department`                        | TEXT    | NULL                     | 部门                        |
| `job_family`、`job_subfamily`       | TEXT    | NULL                     | 职位大类和子类              |
| `locations_json`                    | TEXT    | NOT NULL DEFAULT `'[]'`  | 地点集合                    |
| `employment_type`                   | TEXT    | NULL                     | 工作性质                    |
| `recruitment_category`              | TEXT    | NULL                     | 实习、校招、社招等规范分类  |
| `experience_text`、`education_text` | TEXT    | NULL                     | 年限和学历表达              |
| `description`                       | TEXT    | NOT NULL                 | JD 正文                     |
| `detail_url`、`apply_url`           | TEXT    | NOT NULL                 | 官方详情和投递入口          |
| `published_at`                      | INTEGER | NULL                     | 来源发布时间                |
| `status`                            | TEXT    | CHECK                    | `active`、`stale`、`closed` |
| `missing_count`                     | INTEGER | NOT NULL DEFAULT 0       | 连续完整同步缺失次数        |
| `content_hash`                      | TEXT    | NOT NULL                 | 当前标准化内容哈希          |
| `first_seen_at`、`last_seen_at`     | INTEGER | NOT NULL                 | 首次和最近观察              |
| `closed_at`                         | INTEGER | NULL                     | 关闭时间                    |
| `created_at`、`updated_at`          | INTEGER | NOT NULL                 | 生命周期时间                |

唯一约束：`(source_id, external_job_id)`。主要索引：

- `(status, updated_at DESC)`
- `(company_id, status, updated_at DESC)`
- `(job_family, job_subfamily, status)`
- `published_at`

关键词搜索使用 `title LIKE ? OR department LIKE ? OR description LIKE ?`，输入中的 `%`、`_` 和转义符必须转义并设置显式 `ESCAPE`。

#### 3.2.2 `job_revisions`

职位不可变标准化版本。删除原始记录后，该表是职位内容历史的唯一权威记录。

| 列                    | 类型    | 约束                | 说明                     |
| --------------------- | ------- | ------------------- | ------------------------ |
| `id`                  | TEXT    | PK                  | 修订 ID                  |
| `job_id`              | TEXT    | FK jobs, NOT NULL   | 职位                     |
| `revision_no`         | INTEGER | NOT NULL CHECK >= 1 | 从 1 递增                |
| `content_hash`        | TEXT    | NOT NULL            | 标准化快照哈希           |
| `normalizer_version`  | TEXT    | NOT NULL            | 标准化器版本             |
| `source_payload_hash` | TEXT    | NOT NULL            | 当次来源内容的不可逆哈希 |
| `source_url`          | TEXT    | NOT NULL            | 当次来源 URL             |
| `snapshot_json`       | TEXT    | NOT NULL            | 完整标准化职位快照       |
| `change_set_json`     | TEXT    | NOT NULL            | 与前一版的字段差异       |
| `created_at`          | INTEGER | NOT NULL            | 观察并创建修订的时间     |

唯一约束：`(job_id, revision_no)`、`(job_id, content_hash)`。只有标准化 `content_hash` 变化时创建修订；`source_payload_hash` 不支持恢复原始响应。

#### 3.2.3 `job_observations`

证明某职位的某个标准化版本在一次同步中被看到。

| 列                | 类型    | 约束                       | 说明                 |
| ----------------- | ------- | -------------------------- | -------------------- |
| `job_id`          | TEXT    | FK jobs, NOT NULL          | 职位                 |
| `sync_run_id`     | TEXT    | FK sync_runs, NOT NULL     | 同步运行             |
| `job_revision_id` | TEXT    | FK job_revisions, NOT NULL | 当时生效的标准化版本 |
| `observed_at`     | INTEGER | NOT NULL                   | 观察时间             |

复合主键：`(job_id, sync_run_id)`。应用层必须保证 `job_revision_id` 属于同一个 `job_id`；该不变量由 Repository 和集成测试验证。

### 3.3 候选人、简历与画像

简历来源由通用 `files` 表示，本领域只保存候选人聚合和不可变画像版本。

**事务边界：**简历物理文件写入和文本解析在事务外完成；文件元数据登记和画像任务入队分别使用短事务。应用画像提取或人工修订时，旧当前版本失效和新当前版本创建必须原子提交。

#### 3.3.1 `candidate_profiles`

候选人的当前画像入口，指向唯一生效的不可变画像版本。

| 列                         | 类型    | 约束     | 说明          |
| -------------------------- | ------- | -------- | ------------- |
| `id`                       | TEXT    | PK       | 候选人画像 ID |
| `name`                     | TEXT    | NOT NULL | 本地显示名称  |
| `created_at`、`updated_at` | INTEGER | NOT NULL | 生命周期时间  |

#### 3.3.2 `profile_versions`

候选人事实的不可变版本，保存模型提取结果与人工覆盖后的有效结果。

| 列                  | 类型    | 约束                            | 说明                           |
| ------------------- | ------- | ------------------------------- | ------------------------------ |
| `id`                | TEXT    | PK                              | 画像版本 ID                    |
| `profile_id`        | TEXT    | FK candidate_profiles, NOT NULL | 所属画像                       |
| `version_no`        | INTEGER | NOT NULL CHECK >= 1             | 递增版本号                     |
| `resume_file_id`    | TEXT    | FK files, NULL                  | 来源简历逻辑文件；人工创建可空 |
| `agent_run_id`      | TEXT    | FK agent_runs, NULL             | 提取运行                       |
| `extracted_json`    | TEXT    | NOT NULL                        | 原始结构化提取                 |
| `effective_json`    | TEXT    | NOT NULL                        | 合并人工修订后的有效画像       |
| `locked_paths_json` | TEXT    | NOT NULL DEFAULT `'[]'`         | 禁止后续提取覆盖的路径         |
| `content_hash`      | TEXT    | NOT NULL                        | 有效画像哈希                   |
| `is_current`        | INTEGER | NOT NULL CHECK                  | 当前版本标志                   |
| `created_at`        | INTEGER | NOT NULL                        | 创建时间                       |

唯一约束：`(profile_id, version_no)`；部分唯一索引 `profile_id WHERE is_current = 1` 保证一个画像最多一个当前版本。

### 3.4 Agent、匹配与推导结果

本领域保存 Agent 执行事实和以不可变输入生成的匹配结果。模型输出只能形成新推导结果，不能覆盖职位、画像或用户答案。

**事务边界：**Agent 运行开始先提交 `running`；模型调用在事务外；成功或失败结果用短事务完成。任务随后独立提交 `result_json`；若两次提交间崩溃，重试通过 Agent 缓存恢复。确定性匹配结果及其输入引用在一个事务中创建。

#### 3.4.1 `agent_runs`

记录一次 Agent 执行的输入、输出、状态和可复现信息。

| 列                                 | 类型    | 约束            | 说明                                          |
| ---------------------------------- | ------- | --------------- | --------------------------------------------- |
| `id`                               | TEXT    | PK              | 运行 ID                                       |
| `agent_key`、`agent_version`       | TEXT    | NOT NULL        | Agent 注册键和行为版本                        |
| `prompt_version`                   | TEXT    | NOT NULL        | Prompt 版本                                   |
| `model_config_hash`                | TEXT    | NOT NULL        | 供应商、模型和参数哈希                        |
| `input_hash`                       | TEXT    | NOT NULL        | 脱敏规范输入哈希                              |
| `cache_key`                        | TEXT    | NOT NULL        | 完整缓存键                                    |
| `status`                           | TEXT    | CHECK           | `running`、`succeeded`、`failed`、`cancelled` |
| `output_json`                      | TEXT    | NULL            | 已校验结构化输出                              |
| `error_category`、`error_summary`  | TEXT    | NULL            | 脱敏错误                                      |
| `input_tokens`、`output_tokens`    | INTEGER | NULL CHECK >= 0 | Token 使用量                                  |
| `estimated_cost_micros`            | INTEGER | NULL CHECK >= 0 | 估算成本                                      |
| `cost_currency`、`pricing_version` | TEXT    | NULL            | 币种和估价版本                                |
| `started_at`、`finished_at`        | INTEGER | NOT NULL / NULL | 运行时间                                      |

部分唯一索引：`cache_key WHERE status = 'succeeded'`。相同输入可以保留多次失败，但最多一个成功缓存。

#### 3.4.2 `job_enrichments`

保存针对特定职位修订产生的结构化补充结果。

| 列                | 类型    | 约束                       | 说明                 |
| ----------------- | ------- | -------------------------- | -------------------- |
| `id`              | TEXT    | PK                         | 语义结果 ID          |
| `job_revision_id` | TEXT    | FK job_revisions, NOT NULL | 输入职位修订         |
| `agent_run_id`    | TEXT    | FK agent_runs, NOT NULL    | 运行                 |
| `schema_version`  | TEXT    | NOT NULL                   | 输出 Schema 版本     |
| `content_hash`    | TEXT    | NOT NULL                   | 结果哈希             |
| `result_json`     | TEXT    | NOT NULL                   | 必备项、技能、职级等 |
| `created_at`      | INTEGER | NOT NULL                   | 创建时间             |

唯一约束：`(job_revision_id, agent_run_id)`。

#### 3.4.3 `match_rulesets`

保存可复用、可追溯的职位匹配规则版本。

| 列                | 类型    | 约束            | 说明         |
| ----------------- | ------- | --------------- | ------------ |
| `id`              | TEXT    | PK              | 规则集 ID    |
| `version`         | TEXT    | UNIQUE NOT NULL | 规则版本     |
| `definition_json` | TEXT    | NOT NULL        | 规则定义     |
| `definition_hash` | TEXT    | UNIQUE NOT NULL | 定义哈希     |
| `active`          | INTEGER | NOT NULL CHECK  | 是否当前启用 |
| `created_at`      | INTEGER | NOT NULL        | 创建时间     |

部分唯一索引保证最多一个 `active = 1` 规则集。

#### 3.4.4 `match_results`

保存候选人画像版本与职位修订之间的匹配计算结果。

| 列                   | 类型    | 约束                          | 说明                                |
| -------------------- | ------- | ----------------------------- | ----------------------------------- |
| `id`                 | TEXT    | PK                            | 匹配结果 ID                         |
| `profile_version_id` | TEXT    | FK profile_versions, NOT NULL | 输入画像版本                        |
| `job_revision_id`    | TEXT    | FK job_revisions, NOT NULL    | 输入职位修订                        |
| `job_enrichment_id`  | TEXT    | FK job_enrichments, NULL      | 实际使用的语义结果                  |
| `ruleset_id`         | TEXT    | FK match_rulesets, NOT NULL   | 规则版本                            |
| `filter_status`      | TEXT    | CHECK                         | `eligible`、`excluded`、`uncertain` |
| `total_score`        | REAL    | CHECK 0..100                  | 确定性总分                          |
| `components_json`    | TEXT    | NOT NULL                      | 分项分数、规则和证据                |
| `risks_json`         | TEXT    | NOT NULL                      | 风险项                              |
| `input_hash`         | TEXT    | UNIQUE NOT NULL               | 全部有效输入的组合哈希              |
| `created_at`         | INTEGER | NOT NULL                      | 创建时间                            |

索引：`(profile_version_id, job_revision_id, ruleset_id)`、`(profile_version_id, filter_status, total_score DESC)`。

#### 3.4.5 `match_advices`

保存基于匹配结果生成的求职准备建议。

| 列                | 类型    | 约束                       | 说明                 |
| ----------------- | ------- | -------------------------- | -------------------- |
| `id`              | TEXT    | PK                         | 建议 ID              |
| `match_result_id` | TEXT    | FK match_results, NOT NULL | 确定性匹配结果       |
| `agent_run_id`    | TEXT    | FK agent_runs, NOT NULL    | 建议运行             |
| `schema_version`  | TEXT    | NOT NULL                   | 输出 Schema 版本     |
| `content_hash`    | TEXT    | NOT NULL                   | 建议哈希             |
| `result_json`     | TEXT    | NOT NULL                   | 亮点、缺口和准备建议 |
| `created_at`      | INTEGER | NOT NULL                   | 创建时间             |

唯一约束：`(match_result_id, agent_run_id)`。失败运行不创建建议。

### 3.5 任务、计划与设置

本领域提供通用异步执行和非敏感配置，不为每个业务任务建立结果表。

**事务边界：**任务入队、领取、心跳、完成、重试和取消分别是原子状态转换；计划推进 `next_run_at` 和对应任务入队必须同事务，避免重复或漏发。

#### 3.5.1 `tasks`

通用异步任务队列，负责执行、租约、重试和结果定位。

| 列                                        | 类型    | 约束                   | 说明                                                     |
| ----------------------------------------- | ------- | ---------------------- | -------------------------------------------------------- |
| `id`                                      | TEXT    | PK                     | 任务 ID                                                  |
| `task_type`                               | TEXT    | NOT NULL               | Handler 注册键                                           |
| `payload_json`                            | TEXT    | NOT NULL               | 已校验参数                                               |
| `result_json`                             | TEXT    | NULL                   | 已校验成功结果；终态定位信息                             |
| `status`                                  | TEXT    | CHECK                  | `pending`、`running`、`succeeded`、`failed`、`cancelled` |
| `priority`                                | INTEGER | NOT NULL DEFAULT 0     | 越大越优先                                               |
| `idempotency_key`                         | TEXT    | UNIQUE NOT NULL        | 逻辑幂等键                                               |
| `concurrency_key`                         | TEXT    | NULL                   | 活动任务互斥键                                           |
| `schedule_id`                             | TEXT    | FK schedules, NULL     | 来源计划                                                 |
| `retry_of_task_id`                        | TEXT    | FK tasks, NULL         | 手动重试来源                                             |
| `attempt_count`                           | INTEGER | NOT NULL DEFAULT 0     | 已领取次数                                               |
| `max_attempts`                            | INTEGER | NOT NULL               | 最大尝试次数                                             |
| `available_at`                            | INTEGER | NOT NULL               | 最早执行时间                                             |
| `lease_owner`                             | TEXT    | NULL                   | Worker ID                                                |
| `lease_expires_at`、`last_heartbeat_at`   | INTEGER | NULL                   | 租约和心跳                                               |
| `cancel_requested_at`                     | INTEGER | NULL                   | 运行中取消请求                                           |
| `error_category`、`error_summary`         | TEXT    | NULL                   | 最后错误                                                 |
| `created_at`、`started_at`、`finished_at` | INTEGER | NOT NULL / NULL / NULL | 生命周期时间                                             |

领取索引：`(task_type, status, available_at, priority DESC, created_at)`；恢复索引：`(status, lease_expires_at)`；部分唯一索引 `concurrency_key WHERE status IN ('pending', 'running')`。

`result_json` 只保存任务的小型结构化结果或结果 ID，不复制大型文档。简历润色结果由 `agent_runs.output_json` 保存，任务结果只保存 `agentRunId` 等定位字段。

#### 3.5.2 `schedules`

保存周期任务的调度定义及下一次入队游标。

| 列                                | 类型    | 约束            | 说明           |
| --------------------------------- | ------- | --------------- | -------------- |
| `id`                              | TEXT    | PK              | 计划 ID        |
| `schedule_key`                    | TEXT    | UNIQUE NOT NULL | 稳定计划键     |
| `task_type`                       | TEXT    | NOT NULL        | 任务类型       |
| `payload_json`                    | TEXT    | NOT NULL        | 已校验任务参数 |
| `cron_expression`                 | TEXT    | NOT NULL        | Cron 表达式    |
| `timezone`                        | TEXT    | NOT NULL        | IANA 时区      |
| `enabled`                         | INTEGER | NOT NULL CHECK  | 是否启用       |
| `next_run_at`、`last_enqueued_at` | INTEGER | NOT NULL / NULL | 调度游标       |
| `created_at`、`updated_at`        | INTEGER | NOT NULL        | 生命周期时间   |

`(schedule_key, occurrence_timestamp)` 参与任务幂等键，进程重启不得重复入队。

#### 3.5.3 `application_settings`

保存经过 Registry 校验的非敏感应用设置。

| 列               | 类型    | 约束     | 说明                        |
| ---------------- | ------- | -------- | --------------------------- |
| `key`            | TEXT    | PK       | Registry 声明的非敏感设置键 |
| `value_json`     | TEXT    | NOT NULL | 已校验设置值                |
| `schema_version` | TEXT    | NOT NULL | 设置 Schema 版本            |
| `updated_at`     | INTEGER | NOT NULL | 修改时间                    |

未知 key 一律拒绝。密钥只从环境变量或密钥环读取。

### 3.6 面试准备

本领域包含简历项目拷打、个人面经和网友面经研究。项目代码不进入数据库；深档只读取用户显式上传并冻结的 Markdown 版本，外部研究 Agent 只接收岗位 Brief、Prompt 与输出 Schema。

**事务边界：**创建项目档案时快照和档案原子提交；资料文件写入和 Markdown 解析在事务外完成，版本登记与档案修订在短事务中提交，深档会话在同一事务重验并冻结精确版本；问题、摘要和研究 Task 的入队与业务引用必须同事务，手工重试同事务把引用从失败 Task 切换到新 Task；创建问题、提交回答、消化知识和更新覆盖状态分别使用带修订号的短事务，最终提交核验当前 Task 为 running 且未取消；个人面经草稿替换必须以文件 `revision` CAS，并在同事务替换经历和问题；研究包先在短事务内以研究请求 `revision` 和当前 Task 状态取得带租约的 import claim，再在事务外完成文件写入，最后在短事务内再次核验 Task 并提升正式版本、原子替换未审核候选，逐条审核同样使用 CAS。外部 Agent 与网络调用不进入数据库事务。

#### 3.6.1 `resume_project_snapshots`

从不可变画像版本提取的单个简历项目快照。

| 列                          | 类型    | 约束                | 说明               |
| --------------------------- | ------- | ------------------- | ------------------ |
| `id`                        | TEXT    | PK                  | 快照 ID            |
| `source_profile_id`         | TEXT    | NOT NULL            | 来源画像 ID 快照值 |
| `source_profile_version_id` | TEXT    | NOT NULL            | 来源版本 ID 快照值 |
| `project_index`             | INTEGER | NOT NULL CHECK >= 0 | 项目顺序           |
| `project_json`              | TEXT    | NOT NULL            | 项目描述快照       |
| `content_hash`              | TEXT    | NOT NULL            | 项目哈希           |
| `created_at`                | INTEGER | NOT NULL            | 创建时间           |

唯一约束：`(source_profile_version_id, project_index, content_hash)`。来源 ID 不设外键，确保删除敏感画像后已创建的面试准备档案仍能按显式删除策略处理；其中不得保存联系方式或完整简历。

#### 3.6.2 `project_dossiers`

项目拷打聚合根。

| 列                         | 类型    | 约束                                         | 说明                 |
| -------------------------- | ------- | -------------------------------------------- | -------------------- |
| `id`                       | TEXT    | PK                                           | 档案 ID              |
| `snapshot_id`              | TEXT    | FK resume_project_snapshots, UNIQUE NOT NULL | 项目快照             |
| `notebook_file_id`         | TEXT    | FK files, NULL                               | 最新准备文档逻辑文件 |
| `notebook_source_hash`     | TEXT    | NULL                                         | 生成文档的上下文哈希 |
| `revision`                 | INTEGER | NOT NULL DEFAULT 0                           | 聚合 CAS 修订号      |
| `created_at`、`updated_at` | INTEGER | NOT NULL                                     | 生命周期时间         |

#### 3.6.3 `drill_sessions`

一次项目拷打过程的会话状态和能力档位快照。

| 列                                         | 类型    | 约束                          | 说明                                                   |
| ------------------------------------------ | ------- | ----------------------------- | ------------------------------------------------------ |
| `id`                                       | TEXT    | PK                            | 会话 ID                                                |
| `dossier_id`                               | TEXT    | FK project_dossiers, NOT NULL | 所属档案                                               |
| `profile_key`、`profile_version`           | TEXT    | NOT NULL CHECK                | `resume-only` 或 `docs-grounded`；首版均为 `v1`        |
| `profile_definition_hash`                  | TEXT    | NOT NULL                      | 档位定义哈希                                           |
| `capability_summary_json`                  | TEXT    | NOT NULL                      | 允许的工具和能力摘要                                   |
| `material_bindings_json`                   | TEXT    | NOT NULL DEFAULT `'[]'`       | 深档冻结的 file/version/entity/name/hash；浅档必须为空 |
| `status`                                   | TEXT    | CHECK                         | `active`、`paused`、`completed`                        |
| `context_revision`                         | INTEGER | NOT NULL DEFAULT 0            | 问题生成上下文修订号                                   |
| `created_at`、`updated_at`、`completed_at` | INTEGER | NOT NULL / NOT NULL / NULL    | 生命周期时间                                           |

部分唯一索引保证一个档案最多一个 `active` 或 `paused` 会话。深档绑定必须包含 1–8 个不同逻辑文件且在创建事务中重验；浅档绑定必须为空。项目资料本身不建立专用表：`files(kind=project_material)` 标识逻辑资料，映射的 `normalized_text` 保存规范文本，`metadata_json` 保存所属 dossier、安全文件名、解析器版本和带哈希的标题分块范围。

#### 3.6.4 `drill_turns`

一次渐进式拷打的问题回合。

| 列                                             | 类型    | 约束                        | 说明                                     |
| ---------------------------------------------- | ------- | --------------------------- | ---------------------------------------- |
| `id`                                           | TEXT    | PK                          | 回合 ID                                  |
| `session_id`                                   | TEXT    | FK drill_sessions, NOT NULL | 所属会话                                 |
| `turn_no`                                      | INTEGER | NOT NULL CHECK >= 1         | 会话内序号                               |
| `status`                                       | TEXT    | CHECK                       | pending、awaiting、ready、skipped 等状态 |
| `context_hash`                                 | TEXT    | NOT NULL                    | 生成问题的上下文哈希                     |
| `question`、`intent`                           | TEXT    | NULL                        | 问题和意图                               |
| `primary_dimension`                            | TEXT    | NULL CHECK                  | 主要覆盖维度                             |
| `guidance_slots_json`                          | TEXT    | NOT NULL DEFAULT `'[]'`     | 只含指导槽位，不含代写答案               |
| `evidence_refs_json`                           | TEXT    | NOT NULL DEFAULT `'[]'`     | 问题使用的证据引用                       |
| `question_task_id`、`digest_task_id`           | TEXT    | FK tasks, NULL              | 异步任务                                 |
| `question_agent_run_id`、`digest_agent_run_id` | TEXT    | FK agent_runs, NULL         | Agent 运行                               |
| `created_at`、`updated_at`                     | INTEGER | NOT NULL                    | 生命周期时间                             |

唯一约束：`(session_id, turn_no)`；索引：`(session_id, status, turn_no DESC)`。

#### 3.6.5 `drill_answer_revisions`

用户回答的不可变修订。

| 列                | 类型    | 约束                     | 说明         |
| ----------------- | ------- | ------------------------ | ------------ |
| `id`              | TEXT    | PK                       | 回答修订 ID  |
| `turn_id`         | TEXT    | FK drill_turns, NOT NULL | 所属回合     |
| `revision_no`     | INTEGER | NOT NULL CHECK >= 1      | 回答版本号   |
| `answer_text`     | TEXT    | NOT NULL CHECK 非空      | 用户原始回答 |
| `content_hash`    | TEXT    | NOT NULL                 | 回答哈希     |
| `idempotency_key` | TEXT    | NOT NULL                 | 提交幂等键   |
| `created_at`      | INTEGER | NOT NULL                 | 创建时间     |

唯一约束：`(turn_id, revision_no)`、`(turn_id, idempotency_key)`。

#### 3.6.6 `project_knowledge_items`

只能从用户回答中提取、带原文证据的项目知识。

| 列                           | 类型    | 约束                                | 说明                                                          |
| ---------------------------- | ------- | ----------------------------------- | ------------------------------------------------------------- |
| `id`                         | TEXT    | PK                                  | 知识项 ID                                                     |
| `dossier_id`                 | TEXT    | FK project_dossiers, NOT NULL       | 所属档案                                                      |
| `source_answer_revision_id`  | TEXT    | FK drill_answer_revisions, NOT NULL | 来源回答修订                                                  |
| `kind`                       | TEXT    | CHECK                               | fact、decision、metric、incident、lesson、ambiguity、conflict |
| `statement`                  | TEXT    | NOT NULL                            | 结构化陈述                                                    |
| `quote`                      | TEXT    | NOT NULL                            | 用户回答中的原文证据                                          |
| `source_start`、`source_end` | INTEGER | NOT NULL CHECK                      | 合法字符范围                                                  |
| `status`                     | TEXT    | CHECK                               | `active`、`superseded`                                        |
| `created_at`                 | INTEGER | NOT NULL                            | 创建时间                                                      |

索引：`(dossier_id, status, created_at)`。系统不得把推测或代码扫描结果写成用户事实。

#### 3.6.7 `drill_coverage`

会话各面试维度的物化覆盖状态。

| 列                       | 类型    | 约束                        | 说明                                                                       |
| ------------------------ | ------- | --------------------------- | -------------------------------------------------------------------------- |
| `session_id`             | TEXT    | FK drill_sessions, NOT NULL | 会话                                                                       |
| `dimension`              | TEXT    | CHECK                       | 背景目标、职责、架构、权衡、指标、事故等固定维度                           |
| `status`                 | TEXT    | CHECK                       | unasked、asked、evidence_partial、evidence_sufficient、needs_clarification |
| `evidence_item_ids_json` | TEXT    | NOT NULL DEFAULT `'[]'`     | 支撑状态的知识项 ID                                                        |
| `updated_at`             | INTEGER | NOT NULL                    | 更新时间                                                                   |

复合主键：`(session_id, dimension)`。该表是问题选择的热路径物化状态，因此保留；它可以由回合和知识项重建，但重建成本和一致性复杂度高于一张小型状态表。

#### 3.6.8 `interview_experiences`

个人面经或研究包中的有序面试经历。文档状态、解析文本和警告保存在对应 `files` 与当前 `file_entity_mappings`；`source_type` 和约束保证网友内容不会被当成用户事实。

| 列                                           | 类型    | 约束                                  | 说明                                              |
| -------------------------------------------- | ------- | ------------------------------------- | ------------------------------------------------- |
| `id`                                         | TEXT    | PK                                    | 经历 ID                                           |
| `file_id`                                    | TEXT    | FK files, NOT NULL                    | 个人面经文件或研究 Bundle 逻辑文件                |
| `sequence_no`                                | INTEGER | NOT NULL CHECK >= 1                   | 文件内顺序                                        |
| `source_type`                                | TEXT    | CHECK `personal/community`            | 来源边界                                          |
| `review_status`                              | TEXT    | CHECK                                 | draft、needs_review、accepted、rejected           |
| `research_request_id`                        | TEXT    | FK experience_research_requests, NULL | 网友候选所属请求；个人经历必须为空                |
| `company`、`role`、`stage`                   | TEXT    | NULL                                  | 公司、岗位和阶段                                  |
| `occurred_on`                                | TEXT    | NULL CHECK 日期格式                   | 面试日期                                          |
| `outcome`、`difficulty`                      | TEXT    | NULL                                  | 仅个人面经使用的结果和难度                        |
| `tags_json`                                  | TEXT    | NOT NULL DEFAULT `'[]'`               | 标签                                              |
| `notes`                                      | TEXT    | NULL                                  | 未分类过程备注                                    |
| `source_url`、`source_title`                 | TEXT    | community 时 NOT NULL                 | 公开来源                                          |
| `source_published_at`、`source_retrieved_at` | TEXT    | NULL / community 时 NOT NULL          | 来源发布与检索时间                                |
| `verification_status`                        | TEXT    | CHECK                                 | personal 为 not_applicable；首版网友为 unverified |

唯一约束：`(file_id, sequence_no)`。

#### 3.6.9 `interview_question_entries`

面试经历中的有序问题—回答对。

| 列                          | 类型    | 约束                               | 说明                                   |
| --------------------------- | ------- | ---------------------------------- | -------------------------------------- |
| `id`                        | TEXT    | PK                                 | 问题 ID                                |
| `experience_id`             | TEXT    | FK interview_experiences, NOT NULL | 所属经历                               |
| `sequence_no`               | INTEGER | NOT NULL CHECK >= 1                | 经历内顺序                             |
| `question`                  | TEXT    | NOT NULL CHECK 非空                | 问题                                   |
| `answer`、`reflection`      | TEXT    | NULL                               | 用户回答和复盘；网友内容必须为空       |
| `answer_excerpt`            | TEXT    | NULL                               | 网友来源中的有限回答摘录，不是用户回答 |
| `topics_json`               | TEXT    | NOT NULL DEFAULT `'[]'`            | 网友问题主题标签                       |
| `evidence_excerpt`          | TEXT    | NULL                               | 网友来源中的有限证据摘录               |
| `question_fingerprint`      | TEXT    | NULL CHECK SHA-256                 | 规范问题指纹，用于独立来源计数         |
| `question_source_start/end` | INTEGER | 成对为空或合法范围                 | 问题在规范文本中的证据范围             |
| `answer_source_start/end`   | INTEGER | 成对为空或合法范围                 | 回答在规范文本中的证据范围             |

唯一约束：`(experience_id, sequence_no)`。人工修改内容时清除对应自动解析范围，避免错误指向原文。

#### 3.6.10 `experience_research_requests`

保存一项长期网友面经研究意图；某次执行状态和失败诊断仍由通用 `tasks` 保存，不在本表复制任务状态。

| 列                                                 | 类型           | 约束                     | 说明                                               |
| -------------------------------------------------- | -------------- | ------------------------ | -------------------------------------------------- |
| `id`                                               | TEXT           | PK                       | 研究请求 ID                                        |
| `brief_json`                                       | TEXT           | NOT NULL，严格 Schema    | 冻结岗位、公司、时间、域名和数量约束               |
| `request_fingerprint`                              | TEXT           | UNIQUE NOT NULL，SHA-256 | Brief + 协议版本；封存后派生 generation 的实例指纹 |
| `prompt_version`、`schema_version`                 | TEXT           | NOT NULL                 | 交接协议版本                                       |
| `prompt_file_id`、`schema_file_id`                 | TEXT           | FK files, NOT NULL       | Prompt 与 JSON Schema 逻辑文件                     |
| `prompt_file_version_no`、`schema_file_version_no` | INTEGER        | CHECK 1..5               | 冻结文件版本                                       |
| `bundle_file_id`、`bundle_file_version_no`         | TEXT / INTEGER | 成对为空或版本 1..5      | 当前有效研究包逻辑文件及版本                       |
| `bundle_import_token`                              | TEXT           | NULL，claim 时非空       | 当前 Bundle 导入 claim 的唯一 token                |
| `bundle_import_claimed_at`                         | INTEGER        | NULL，claim 时非负       | claim 时间；超过 5 分钟可回收                      |
| `bundle_import_file_id`                            | TEXT           | NULL，claim 时非空       | 本次 claim 独占的 staging 逻辑文件 ID              |
| `current_task_id`                                  | TEXT           | FK tasks, NULL           | 最近一次外部执行任务                               |
| `state`                                            | TEXT           | CHECK                    | ready、needs_review、completed                     |
| `revision`                                         | INTEGER        | NOT NULL DEFAULT 0       | 导包与审核 CAS                                     |
| `created_at`、`updated_at`                         | INTEGER        | NOT NULL                 | 生命周期时间                                       |

Prompt、Schema 和 Bundle 均使用 `files(kind=interview_research)`；同一请求的有效 Bundle 最多五个版本。三个 import claim 字段必须全空或全非空；有效租约阻止同修订并发导入，过期租约的 staging 映射与无共享实体由下一次 claim 回收。Bundle 候选在没有 accepted 项时可按请求修订号整体替换，一旦已有接受项便禁止静默覆盖。

### 3.7 通用文件与事件基础设施

本领域只提供跨领域稳定能力，不承载业务实体本身。

**事务边界：**实体去重、逻辑文件和版本关联在同一事务登记；业务引用尽可能在同一个数据库事务提交。事件必须与引发它的当前态更新同事务。文件物理隔离与数据库删除使用补偿流程。

#### 3.7.1 `files`

业务引用的逻辑文件身份，独立于具体物理内容版本。

| 列                         | 类型    | 约束                    | 说明                                                             |
| -------------------------- | ------- | ----------------------- | ---------------------------------------------------------------- |
| `id`                       | TEXT    | PK                      | 逻辑文件 ID                                                      |
| `kind`                     | TEXT    | NOT NULL                | Registry 类型：resume、interview_experience、project_notebook 等 |
| `name`                     | TEXT    | NOT NULL CHECK 非空     | 安全显示名称，不解释为本地路径                                   |
| `state`                    | TEXT    | NOT NULL                | 类型相关状态，由 kind 对应 Schema 校验                           |
| `revision`                 | INTEGER | NOT NULL DEFAULT 0      | 可编辑逻辑文件 CAS 修订号                                        |
| `properties_json`          | TEXT    | NOT NULL DEFAULT `'{}'` | 类型相关低频元数据                                               |
| `created_at`、`updated_at` | INTEGER | NOT NULL                | 生命周期时间                                                     |

索引：`(kind, updated_at DESC)`。删除业务文档时通常硬删除逻辑文件；历史保留由引用它的业务事实决定。

类型映射：

| kind                   | state                              | properties_json 示例                              |
| ---------------------- | ---------------------------------- | ------------------------------------------------- |
| `resume`               | pending、parsed、needs_ocr、failed | 上传来源等非敏感信息                              |
| `interview_experience` | draft、accepted、rejected          | sourceMode、templateVersion、warnings、acceptedAt |
| `project_notebook`     | stored                             | sourceHash                                        |
| `project_material`     | stored                             | dossierId、fileName                               |
| `interview_research`   | stored、needs_review               | researchRequestId、assetType                      |

#### 3.7.2 `entities`

经过内容寻址和去重的不可变物理文件实体。

| 列              | 类型    | 约束                | 说明                     |
| --------------- | ------- | ------------------- | ------------------------ |
| `id`            | TEXT    | PK                  | 物理实体 ID              |
| `relative_path` | TEXT    | UNIQUE NOT NULL     | 相对数据根目录的受控路径 |
| `media_type`    | TEXT    | NOT NULL            | MIME                     |
| `sha256`        | TEXT    | NOT NULL CHECK      | 内容哈希                 |
| `byte_size`     | INTEGER | NOT NULL CHECK >= 0 | 字节数                   |
| `created_at`    | INTEGER | NOT NULL            | 登记时间                 |
| `deleted_at`    | INTEGER | NULL                | 隔离时间；清除后删除记录 |

活动实体使用部分唯一索引 `sha256 WHERE deleted_at IS NULL` 实现物理内容去重。

#### 3.7.3 `file_entity_mappings`

连接逻辑文件与物理实体，并承载该版本的解析结果。

| 列                | 类型    | 约束                    | 说明                         |
| ----------------- | ------- | ----------------------- | ---------------------------- |
| `file_id`         | TEXT    | FK files, NOT NULL      | 逻辑文件                     |
| `entity_id`       | TEXT    | FK entities, NOT NULL   | 物理内容                     |
| `version_no`      | INTEGER | CHECK 1..5              | 内容版本号                   |
| `parser_version`  | TEXT    | NULL                    | 文本解析器版本               |
| `parse_status`    | TEXT    | NULL                    | 解析状态                     |
| `extracted_text`  | TEXT    | NULL                    | 确定性提取文本               |
| `normalized_text` | TEXT    | NULL                    | 清洗后的规范文本             |
| `error_summary`   | TEXT    | NULL                    | 脱敏解析错误                 |
| `metadata_json`   | TEXT    | NOT NULL DEFAULT `'{}'` | 与该内容版本绑定的低频元数据 |
| `created_at`      | INTEGER | NOT NULL                | 版本登记时间                 |

复合主键：`(file_id, version_no)`；唯一约束：`(file_id, entity_id)`；索引：`(entity_id, file_id)`。第六个版本由数据库直接拒绝，不自动覆盖旧版本。

#### 3.7.4 `events`

统一保存各领域不可变、按事件流有序的状态变化与操作事实。

| 列             | 类型    | 约束                    | 说明                                   |
| -------------- | ------- | ----------------------- | -------------------------------------- |
| `id`           | TEXT    | PK                      | 事件 ID                                |
| `stream_type`  | TEXT    | NOT NULL                | job、sync_run、agent_run、operation 等 |
| `stream_id`    | TEXT    | NOT NULL                | 主体 ID 或不可逆主体哈希               |
| `sequence_no`  | INTEGER | NOT NULL CHECK >= 1     | 流内序号                               |
| `event_type`   | TEXT    | NOT NULL                | 命名空间事件名                         |
| `payload_json` | TEXT    | NOT NULL DEFAULT `'{}'` | 已校验、已脱敏事件负载                 |
| `occurred_at`  | INTEGER | NOT NULL                | 发生时间                               |

唯一约束：`(stream_type, stream_id, sequence_no)`；索引：`(stream_type, stream_id, occurred_at)`、`(event_type, occurred_at)`。

主要事件负载：

| event_type            | payload 必需字段                                                       |
| --------------------- | ---------------------------------------------------------------------- |
| `job.status.changed`  | syncRunId、fromStatus、toStatus、reasonCode、evidence                  |
| `sync.item.failed`    | sourceId、externalJobId、sourceUrl、stage、errorCategory、errorSummary |
| `agent.tool.finished` | toolKey、status、durationMs、脱敏输入/输出摘要                         |
| `resume.deleted`      | 不可逆影响哈希和计数，不含原文、路径或被删实体 ID                      |

## 4. 跨领域事务设计

| 用例          | 同一事务内必须完成                                                            | 事务外工作与失败恢复                                                      |
| ------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 开始同步      | 创建 `sync_runs(running)`                                                     | HTTP 和浏览器抓取在提交后执行                                             |
| 首次发现职位  | `jobs`、首个 `job_revisions`、`job_observations`、`sync_seen_jobs`、状态事件  | 解析与标准化先完成并校验                                                  |
| 职位内容变化  | 更新 `jobs`、新增 `job_revisions`、新增观察和已见标记                         | 无原始响应落库；失败整项回滚                                              |
| 重复观察      | 新增观察和已见标记、更新 `last_seen_at`                                       | 不创建修订                                                                |
| 职位状态变化  | 更新状态/缺失计数并追加 `job.status.changed`                                  | 完整性计算在事务前完成；可按职位批次提交                                  |
| 同步完成      | 更新运行状态、覆盖证据、统计和游标                                            | 仅在所有缺失推进批次完成后标记成功                                        |
| Task 领取     | pending → running、租约、尝试次数 CAS                                         | Handler 在事务外执行                                                      |
| Task 成功     | running → succeeded、`result_json`、完成时间                                  | 输出先通过 Handler Schema；租约丢失则不提交                               |
| 发布面试 Task | 创建 pending Task，并关联 turn 或 ResearchRequest                             | payload 在事务前校验；失败整体回滚，不暴露未关联 Task                     |
| 重试面试 Task | 创建 retry Task，并把业务引用从旧 failed Task 原子切换到新 Task               | 业务状态已变化则拒绝重试，新 Task 不得抢跑                                |
| Agent 执行    | 分别原子创建 running 和提交终态                                               | 模型调用在两次事务之间；崩溃由缓存和任务重试恢复                          |
| 导入文档      | 文件、实体、版本及首个业务引用的数据库登记                                    | 临时文件写入、解析在事务外；失败产生的孤立文件延迟清理                    |
| 保存面经草稿  | 文件 revision CAS，替换经历和问题                                             | 旧 revision 返回冲突，不部分更新                                          |
| 登记项目资料  | 逻辑文件新版本、解析元数据与 dossier revision                                 | Markdown 校验、规范化和分块在事务外                                       |
| 开始深档拷打  | 重验 1–8 个当前资料版本并冻结 session bindings、初始化覆盖状态                | 不读取项目目录；问题片段在 Worker 执行期按冻结版本选择                    |
| 导入研究包    | claim/finalize 均核验当前 running 且未取消的 Task；提升 mapping、CAS 替换候选 | JSON/Schema/URL 校验和 staging Bundle 文件写入在事务外；失败/过期补偿清理 |
| 审核网友面经  | 单条候选状态、request revision 与聚合状态 CAS                                 | 外部链接不在事务中访问                                                    |
| 删除敏感文档  | 重验影响快照、删除业务引用和逻辑文件、追加审计事件                            | 先隔离独占物理实体；事务失败恢复，成功后清除                              |
| 推进计划      | 更新 `schedules.next_run_at` 并创建幂等 Task                                  | Cron 计算在事务前完成                                                     |

## 5. 关键跨表不变量

1. 每家公司恰好有三个逻辑渠道；每个物理来源只属于同公司的一个逻辑渠道。
2. 一个物理来源最多一个 `running` SyncRun，最多一个相同并发键的 pending/running Task。
3. `sync_runs.coverage != complete` 时不得推进未观察职位的 `missing_count`。
4. `jobs.content_hash` 改变必须创建对应 `job_revisions`；状态改变必须追加事件。
5. `job_observations.job_revision_id` 必须属于同一 `job_id`。
6. 一个 CandidateProfile 最多一个当前 ProfileVersion。
7. MatchResult 必须引用不可变画像版本、职位修订、实际语义结果或空哨兵及规则集。
8. Agent 失败结果不能成为缓存命中；成功 `cache_key` 最多一条。
9. 一个逻辑文件最多五个实体版本；共享实体不能因删除单个逻辑文件被隔离。
10. 已接受个人面经首版只读；草稿更新必须匹配文件 revision。
11. 项目拷打知识只能引用用户回答证据，不得把推断或代码扫描写成用户事实。
12. 深档问题只能引用会话冻结资料版本中的真实分块；新资料版本不得改变既有会话上下文。
13. 网友回答摘录只能写入 `answer_excerpt`，不得写入代表用户事实的 `answer`；未接受候选不得进入网友面经查询。
14. 一个研究请求同时最多一个有效 Bundle import claim；失败或过期 staging 不得成为正式版本，也不得消耗五版本额度。
15. 外部研究结果的请求指纹和 Schema 版本必须匹配当前请求；迟到任务不得覆盖较新 revision。

## 6. 保留、清理与备份

- `jobs` 和 `job_revisions` 默认长期保留；`job_observations` 默认保留 180 天。
- 不保存完整原始职位响应；`source_job_details` 是可重建缓存，默认最多保留 30 天未命中记录，失败缓存可以更短。
- `sync_seen_jobs` 在运行完成后清理；异常退出的工作集由恢复任务清理。
- `events` 按事件类型保留：职位生命周期和敏感删除审计长期保留；同步失败与 Agent 工具诊断可随其运行保留策略清理。
- Agent 成功结果按被引用关系保留；无引用失败/取消运行可按期限清理。
- 简历、个人面经和项目资料只允许通过所属聚合的显式删除流程清理；删除前展示稳定影响快照。
- 研究 Prompt、Schema 与最多五版有效 Bundle 随研究请求保留；网友面经只长期展示人工接受项，拒绝项可按后续显式保留策略清理。
- 文件实体失去最后引用后先隔离，数据库提交成功后清除；24 小时以上的未登记孤立文件可以清理。
- 备份先使用 SQLite Online Backup API 创建一致性快照，再从快照读取活动 `entities` 清单并复制、校验 SHA-256。
- 恢复要求 CLI、Worker 和 Web 停止，在临时目录验证数据库、实体哈希和外键后原子切换。

## 7. 表审计结论

### 7.1 目标业务表清单

目标模型包含 33 张业务表：

| 领域           | 表                                                                                                                                                                                                                                            |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 来源目录与同步 | `companies`、`source_channels`、`job_sources`、`sync_runs`、`source_job_details`、`sync_seen_jobs`                                                                                                                                            |
| 职位事实       | `jobs`、`job_revisions`、`job_observations`                                                                                                                                                                                                   |
| 候选人画像     | `candidate_profiles`、`profile_versions`                                                                                                                                                                                                      |
| Agent 与匹配   | `agent_runs`、`job_enrichments`、`match_rulesets`、`match_results`、`match_advices`                                                                                                                                                           |
| 任务与设置     | `tasks`、`schedules`、`application_settings`                                                                                                                                                                                                  |
| 面试准备       | `resume_project_snapshots`、`project_dossiers`、`drill_sessions`、`drill_turns`、`drill_answer_revisions`、`project_knowledge_items`、`drill_coverage`、`experience_research_requests`、`interview_experiences`、`interview_question_entries` |
| 通用基础设施   | `files`、`entities`、`file_entity_mappings`、`events`                                                                                                                                                                                         |

### 7.2 删除或合并结论

| 旧对象                              | 结论 | 替代或原因                                                  |
| ----------------------------------- | ---- | ----------------------------------------------------------- |
| `jobs_fts` 及 shadow tables、触发器 | 删除 | 当前规模用 `jobs` 上的 `LIKE`；真实基准证明需要时再立 ADR   |
| `raw_job_records`                   | 删除 | 不归档完整原始响应；修订保存来源哈希、URL 和标准化快照      |
| `file_artifacts`                    | 删除 | 拆为逻辑 `files`、物理 `entities` 和 `file_entity_mappings` |
| `resume_documents`                  | 删除 | 简历由 `files(kind=resume)` 和版本解析字段表达              |
| `experience_documents`              | 删除 | 面经文档由通用文件表达，经历和问题仍是领域表                |
| `job_status_events`                 | 合并 | `events(job.status.changed)`                                |
| `sync_item_failures`                | 合并 | `events(sync.item.failed)`；删除无用 rawRecordId            |
| `agent_tool_calls`                  | 合并 | `events(agent.tool.finished)`                               |
| `operation_audit_events`            | 合并 | `events` 的 operation 流                                    |
| `resume_polish_suggestions`         | 删除 | 结果以 `agent_runs.output_json` 为事实，Task 保存结果定位   |

### 7.3 特别保留说明

- `source_job_details` 有实际缓存读路径，能避免列表未变化时重复抓详情；它可过期、可重建，不是原始档案。
- `sync_seen_jobs` 是内存有界同步所需的临时工作集，不进入长期业务查询。
- `job_observations` 是“某次完整同步确实看到职位”的长期证据，不能只依赖 `last_seen_at`。
- `drill_coverage` 是问题选择热路径的小型物化状态，保留比每次重放全部回合和知识项更简单。
- `experience_research_requests` 保存长期研究意图和人工审核生命周期；一次外部执行仍复用 `tasks`，两者职责不重复。
- `interview_experiences` 和 `interview_question_entries` 是受约束的领域实体，不应退化为文件 JSON。

## 8. 迁移与验证要求

数据库收敛迁移必须按“创建新结构、复制、验证、切换引用、删除旧结构”的顺序执行，并满足：

1. 空库初始化成功，业务表清单与第 7.1 节完全一致。
2. 从上一正式 Schema 升级不丢失职位修订、观察、简历、面经、项目拷打、任务、Agent 和匹配数据。
3. `raw_job_records` 删除前，将被修订使用的来源哈希和 URL 回填到 `job_revisions`，将观察映射到对应 `job_revision_id`。
4. FTS 虚表、shadow tables 和同步触发器全部删除，关键词查询回归测试覆盖 `%`、`_` 和转义符。
5. 旧文档表正确映射到逻辑文件、物理实体和版本；共享内容只生成一个活动物理实体。
6. 第六个文件实体版本被数据库拒绝；删除共享逻辑文件不影响其余引用。
7. 四类旧事件完整迁入 `events`，流内序号稳定且唯一。
8. 迁移完成后通过 `PRAGMA foreign_key_check`、`PRAGMA integrity_check` 和主要 Repository 集成测试。
9. 备份、清理和 doctor 只识别新模型，不引用已删除对象。
10. 旧浅档会话迁入后绑定数组为空；深档资料登记、五版本上限和冻结版本读取通过集成测试。
11. 旧个人面经保持 `personal` 来源语义；网友候选的回答摘录与用户回答分列保存，只有 accepted community 记录进入网友面经读取模型。
12. `0022` 保证同一档案同名项目资料只有一个逻辑文件；`0023` 的 Bundle claim、staging 提升、失败补偿、过期回收和第五/第六版本边界必须通过双连接集成测试。

本文是目标设计，当前代码与迁移在完成实现和全部验证前不得标记为 Accepted。
