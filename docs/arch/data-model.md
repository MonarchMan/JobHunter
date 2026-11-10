# 数据模型与 SQLite 表设计

> 周期存储更新：0054 将周期配置与触发进度迁入 application_settings，删除 schedules 和 tasks.schedule_id；到期扫描由中央服务负责，历史表说明仅用于理解迁移来源。该迁移尚未应用于真实数据。

0055 已将 tasks.payload_json/result_json 迁为 private_state/public_state，并补充输入更新后的关联索引维护；仅在临时数据库完成验证，尚未应用到真实数据。

> 面试准备与画像的新目标见 [034 规格](../../specs/034-ai-sessions-and-projects/spec.md) 与 [ADR-0063](../adr/0063-ai-sessions-and-local-projects.md)。会话/消息/元数据替代专用对话表，项目关联本地路径，研究结果写入指定 JSON 路径。旧表定义用于迁移来源说明，不代表新目标已落地。

> 0056 已将 sync_runs 合并为扫描阶段任务，观测和已见集合外键转向 tasks；public_state/private_state 和周期设置迁移已实现，三个阶段验收与真实数据迁移已于 2026-11-06 完成。详见 [ADR-0062](../adr/0062-central-task-scheduler.md)。

> 状态：Proposed
> 版本：2.1.1
> 日期：2026-10-14
> 上位文档：[总体架构](./overall-arch.md)

## 1. 目的、范围与设计目标

本文档定义 JobHunter 的目标 SQLite 数据模型，是 Drizzle Schema、迁移、Repository、清理、备份和集成测试的共同依据。本文只描述业务表；SQLite 自身的 `sqlite_*`、Drizzle 迁移表等内部对象不属于业务数据模型。

### 招聘平台目标模型增量（设计已确定，尚未迁移）

[ADR-0045](../adr/0045-platform-job-lifecycle-and-tasks.md) 与 [028 设计](../../specs/028-recruitment-platforms/design.md) 扩展下文官网基线约束：job_sources 新增 official/platform 类别，官网 company_id、channel_id 非空，平台两者为空且不适用 coverage_role；用 CHECK 限制分支，不放松既有官网不变量。平台招聘公司由职位解析，经 provider_key + external_company_id 的唯一身份映射关联 companies，不把平台当公司。

新增 platform_connections 仅存非敏感配置、generation 和脱敏连接状态；凭据、私有游标、推荐上下文不入库。jobs 与匹配沿用正式事实模型，不建平台职位缓存表；jobs 增加核验及用户交互时间供保留策略使用。job_observations 归属为 sync_run_id 或 platform_task_id，外键与 CHECK 保证恰有一种；平台不写 sync_seen_jobs 或伪同步运行。首次职位写入在同一短事务内保存当前内容、相应观察与状态事件，已见标记只适用于官网同步。

平台清理使用更短的可配置保留期限和独立检查频率，不以来源缺失推导下架。收藏、投递、面试准备、笔记及当前任务引用优先保护；删除前事务内重检，观察对任务的引用也须纳入清理排序。正式职位清理不是缓存淘汰，物理压缩仍遵守 ADR-0020。以下表中尚未扩展的非空及同步归属约束描述官网现有基线，平台迁移以本增量和 028 设计为准。

### 招聘邮件目标模型增量（设计已确定，尚未迁移）

[ADR-0055](../adr/0055-recruitment-mail-ingestion-and-privacy-boundary.md) 与 [029 设计](../../specs/029-recruitment-mail/design.md) 新增独立的招聘邮件引用和求职申请数据。邮箱不是 `job_sources` 的一种，邮件事件不参与职位覆盖、缺失或关闭判断；申请可以选择性引用现有 `jobs`，但邮件拒绝、流程结束和 Offer 不修改职位事实。

邮箱账号、provider、文件夹、计划、脱敏地址和 `credentialRef` 保存在本地非敏感配置；默认配置文件为 `<dataRoot>/mail/mailboxes.json`，也可由工作区 `.env` 的 `MAILBOX_CONFIG_PATH` 指定。提供商同步游标、连接代次和最近同步结果保存在数据目录运行状态文件。SQLite 只保存最小消息引用、申请当前投影和申请事件。Token、刷新令牌、应用专用密码、原始 MIME、完整 HTML、普通附件、无关邮件正文和待确认中间分类结果不入库。与招聘无关或待确认的邮件不得保存主题或发件地址，只保留去重与重新读取所需的外部身份、内容哈希、处理结论和版本。

邮箱读取按增量页提交：外部请求和正文解析在事务外完成，短事务原子保存消息引用并发布分类任务，提交成功后再原子替换运行状态文件中的页游标。数据库提交后、游标写入前崩溃允许整页重放；重复游标、任务恢复和分类器重跑由消息与事件唯一约束去重。分类提交短事务更新消息结论、追加申请事件并更新申请当前态。

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

### 2.0 简历模板草稿与导出

- `resume_template_drafts` 保存个人资料与内置模板版本唯一的投递草稿、公开内容、头像引用和乐观并发 revision。
- `resume_export_requests` 保存 PDF/HTML 的短期本地交付记录，关联不可变 HTML 输入、可选 PDF 输出、任务与 24 小时过期时间。
- 源画像版本 ID 只用于陈旧提示，不建立外键；草稿归属个人资料，个人资料被硬删除前必须清理草稿、头像和中转文件。

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

| 类型       | 例子                                               | 更新规则                       |
| ---------- | -------------------------------------------------- | ------------------------------ |
| 当前态     | `jobs`、`candidate_profiles`、`job_applications`   | 原地更新，服务主要查询入口     |
| 不可变版本 | `profile_versions`                                 | 不静默覆盖；按领域保留策略淘汰 |
| 观察与事件 | `job_observations`、`application_events`、`events` | 只追加或按明确保留策略清理     |
| 推导结果   | `job_metadata`                                     | 引用不可变输入，绝不反写事实   |

相同有效输入必须用稳定哈希或唯一约束实现幂等。只有内容实际变化时才产生新版本；重复观察不制造新版本。

### 2.3 JSON 字段

JSON 使用 `TEXT` 保存，只适用于：

- 有明确 Schema 的版本化快照；
- 低频、整体读取的值对象；
- 不参与主要过滤、连接和唯一约束的扩展字段；
- 不同事件类型的负载。

所有 JSON 在应用边界使用 Zod 校验，写入前按稳定键序列化，读取后在使用边界再次校验。需要经常过滤、排序、连接或建立约束的字段必须提升为普通列。

JSON 中不得保存模型密钥、认证 Cookie、完整简历正文的日志副本或未脱敏错误堆栈。

邮箱增量游标可以作为不透明 JSON 保存，但不得包含可直接用于授权的 Token；游标、邮件链接和错误响应不进入日志。申请事件 JSON 只保存经过 Schema 校验的结构化字段和有长度上限的证据，不保存原始 MIME、完整 HTML 或无关邮件正文。

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

#### 3.1.4 来源扫描阶段任务

一次物理来源扫描保存为 tasks 中的 source.scan 阶段任务，parent_task_id 关联 source.sync 主任务。没有 sync_runs 表。阶段由主任务在当前分派下执行，不参与独立领取；主任务失去执行权时原子取消未完成阶段。

- private_state：sourceId、trigger，以及成功扫描得到的 cursorOut。输入游标可从上次成功扫描重建；版本号和配置哈希不重复保存。
- public_state：status（保留 partial 业务结果）、coverage、stats、coverageEvidence；通用 status 将已完成的 partial 扫描记为 succeeded，来源健康和缺失判断仍使用 coverage。
- 公共列：id、parent_task_id、source_id 索引投影、执行状态、错误分类/摘要与时间。

保留历史扫描 ID 及观测关联；新一次全量扫描使用新 ID。只有评分恢复时复用原扫描。部分唯一索引保证每个来源最多一个 running 扫描，来源和开始时间索引支持最近扫描查询。

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

复合主键：`(source_id, external_job_id)`。网络请求结束并校验后，以一个短事务覆盖该缓存；不得被职位当作永久证据引用。

#### 3.1.6 `sync_seen_jobs`

同步运行期间的有界工作集，用于流式记录本轮已观察职位，避免在内存保存来源全部职位。

| 列            | 类型 | 约束               | 说明       |
| ------------- | ---- | ------------------ | ---------- |
| `sync_run_id` | TEXT | FK tasks, NOT NULL | 同步运行   |
| `job_id`      | TEXT | FK jobs, NOT NULL  | 已观察职位 |

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

#### 3.2.2 当前职位内容

jobs 直接保存当前事实，content_id 唯一标识当前输入；内容变化替换该身份，并清理派生结果。source_payload_hash 与 source_url 保存来源追溯信息，不保留历史正文快照。

#### 3.2.3 `job_observations`

证明某职位的某个标准化版本在一次同步中被看到。

| 列            | 类型    | 约束               | 说明     |
| ------------- | ------- | ------------------ | -------- |
| `job_id`      | TEXT    | FK jobs, NOT NULL  | 职位     |
| `sync_run_id` | TEXT    | FK tasks, NOT NULL | 同步运行 |
| `observed_at` | INTEGER | NOT NULL           | 观察时间 |

复合主键：`(job_id, sync_run_id)`。应用层必须保证 `job_revision_id` 属于同一个 `job_id`；该不变量由 Repository 和集成测试验证。

### 3.3 候选人、简历与画像

简历来源由通用 `files` 表示，本领域只保存候选人聚合和不可变画像版本。

**事务边界：**简历物理文件写入和文本解析在事务外完成；文件元数据登记和画像任务入队分别使用短事务。应用画像提取或人工修订时，旧当前版本失效、新当前版本创建、超额旧版本及其匹配推导清理必须原子提交。

#### 3.3.1 `candidate_profiles`

候选人的当前画像入口，指向唯一生效的不可变画像版本。

| 列                         | 类型    | 约束     | 说明          |
| -------------------------- | ------- | -------- | ------------- |
| `id`                       | TEXT    | PK       | 候选人画像 ID |
| `name`                     | TEXT    | NOT NULL | 本地显示名称  |
| `created_at`、`updated_at` | INTEGER | NOT NULL | 生命周期时间  |

#### 3.3.2 `profile_versions`

画像按明确的一级属性分列，不保存 extracted_json、effective_json 或 locked_paths_json。集合使用各自 JSON 列：basic_info_json、matching_constraints_json、target_roles_json、intended_roles_json、preferences_json、education_json、work_experience_json、projects_json、works_json、competitions_json、certificates_json、languages_json、skills_json、domains_json；标量为 professional_skills、self_evaluation、years_of_experience、management_experience。

公共身份列保留 id、profile_id、version_no、resume_file_id、agent_run_id、content_hash、created_at。is_current 标识唯一当前版本；is_candidate 标识待确认提取结果，base_version_id 记录其提取基线。首次提取建立当前画像；再次提取只追加候选，用户选择字段且基线未变化时才生成生效版本。匹配不得读取候选。最近五个已确认版本保留，候选不挤占其保留名额。

projects 中每项使用稳定 id 和可空 local_path；模型不能覆盖身份和路径，人工编辑、排序保持 id。画像删除或项目移除时清除会话的对应元数据关联，不删除消息。

### 3.4 Agent、匹配与推导结果

本领域保存 Agent 执行事实和以不可变输入生成的匹配结果。模型输出只能形成新推导结果，不能覆盖职位、画像或用户答案。

**事务边界：**Agent 运行开始先提交 `running`；模型调用在事务外；成功或失败结果用短事务完成。任务随后独立提交 `public_state`；若两次提交间崩溃，可恢复后台任务通过同任务步骤结果恢复。确定性匹配结果及其输入引用在一个事务中创建。

#### 3.4.1 `agent_runs`

记录一次 Agent 执行的输入、输出、状态和可复现信息。

逐请求事实保存于 common 的 `model_requests`，不再使用 `model_usage_json`，运行表也不保存请求 ID 数组。运行详情通过 `agent_run_id` 返回请求 ID 和账单；运行汇总列保留，无请求明细的历史合计不伪造明细。参见 [ADR-0059](../adr/0059-model-request-ledger.md)。

`model_requests` 保存请求 ID、可空 `ai_message_id`（消息删除置空）、可空 `agent_run_id`（ON DELETE SET NULL）、`agent_key` 快照、`state`（running/completed）、请求时间、供应商主机、模型、HTTP 状态、错误类别、耗时、首字、归一化用量、分项费用、币种、价格版本/时段/精度和 `rates_json` 单价快照。每次网络请求发起前登记，结束后幂等更新；未知字段为 NULL，不包含正文、提示词或密钥。时间、运行关联及供应商/模型与时间建立索引。运行清理不删除账本。

| 列                                 | 类型    | 约束            | 说明                                          |
| ---------------------------------- | ------- | --------------- | --------------------------------------------- |
| `id`                               | TEXT    | PK              | 运行 ID                                       |
| `agent_key`、`agent_version`       | TEXT    | NOT NULL        | Agent 注册键和行为版本                        |
| `prompt_version`                   | TEXT    | NOT NULL        | Prompt 版本                                   |
| `model_config_hash`                | TEXT    | NOT NULL        | 供应商、模型和参数哈希                        |
| `input_hash`                       | TEXT    | NOT NULL        | 脱敏规范输入哈希                              |
| `cache_key`                        | TEXT    | NOT NULL        | 执行恢复键（普通调用使用独立身份）            |
| `status`                           | TEXT    | CHECK           | `running`、`succeeded`、`failed`、`cancelled` |
| `output_json`                      | TEXT    | NULL            | 已校验结构化输出                              |
| `error_category`、`error_summary`  | TEXT    | NULL            | 脱敏错误                                      |
| `input_tokens`、`output_tokens`    | INTEGER | NULL CHECK >= 0 | Token 使用量                                  |
| `estimated_cost_micros`            | INTEGER | NULL CHECK >= 0 | 估算成本                                      |
| `cost_currency`、`pricing_version` | TEXT    | NULL            | 币种和估价版本                                |
| `started_at`、`finished_at`        | INTEGER | NOT NULL / NULL | 运行时间                                      |

部分唯一索引：`cache_key WHERE status = 'succeeded'`。相同输入可以保留多次失败，但最多一个成功缓存。

普通 Agent 调用不保存输出正文；AI 回复仅存 ai_messages。后台任务显式使用 runStep，按任务、步骤、资源与输入定位恢复结果；邮件分类使用邮箱、消息和内容版本隔离。恢复输出仅在任务尚未成功提交时保留，任务成功、取消或删除时清除，诊断及请求账本保留。简历润色建议由 user 模块的 resume_polish_suggestions 保存，不依赖 Agent 输出副本。运行新增 task_id、step_key、resource_key；分派轮次只保存在 tasks，不重复增加 task_attempt；历史关联为空，task_id 不设外键，以便任务删除后仍保留诊断身份。

#### 3.4.2 `job_metadata`

| 字段       | 类型    | 约束与用途                             |
| ---------- | ------- | -------------------------------------- |
| id         | TEXT    | 独立主键                               |
| job_id     | TEXT    | jobs 外键，删除级联                    |
| name       | TEXT    | enrichment、match_result、match_advice |
| value      | TEXT    | 严格校验的 JSON 对象                   |
| created_at | INTEGER | 首次创建时间                           |
| updated_at | INTEGER | 最近结果更新时间                       |

UNIQUE(job_id, name) 保证每职位每类型只保存一份当前结果；覆盖保留 ID。规则定义由代码常量提供。

评分 JSON 保存输入身份和摘要、filter_status、total_score、components、risk_results、unknown_rules、model。components 仅保存 dimension、score、max_score；风险与未知规则为标识数组；model 为 null 或 {score, reasons}。解析和建议保存结果及 Agent 运行引用，建议绑定评分输入摘要。评分排序通过 JSON 表达式索引实现。

### 3.5 任务、计划与设置

本领域提供通用异步执行和非敏感配置，不为每个业务任务建立结果表。

**事务边界：**任务入队、领取、心跳、完成、重试和取消分别是原子状态转换；计划推进 `next_run_at` 和对应任务入队必须同事务，避免重复或漏发。

#### 3.5.1 `tasks`

通用异步任务队列，负责执行、租约、重试和结果定位。

每轮尝试上限由 Handler 的系统配置提供，不保存到任务行，也不接受入队覆盖。`attempt_count` 保留累计领取次数，减去最近 `task_retry_logs.attempt_count` 得到本轮次数；手动重试、自动退避和租约恢复使用相同预算语义。

| 列                                        | 类型    | 约束                   | 说明                                                     |
| ----------------------------------------- | ------- | ---------------------- | -------------------------------------------------------- |
| `id`                                      | TEXT    | PK                     | 任务 ID                                                  |
| `parent_task_id`                          | TEXT    | FK tasks, NULL         | 内部阶段归属的主任务                                     |
| `task_type`                               | TEXT    | NOT NULL               | Handler 注册键                                           |
| `private_state`                           | TEXT    | NOT NULL               | 经任务 Schema 校验的执行输入                             |
| `public_state`                            | TEXT    | NULL                   | 脱敏进度、检查点、结果及定位信息                         |
| `status`                                  | TEXT    | CHECK                  | `pending`、`running`、`succeeded`、`failed`、`cancelled` |
| `priority`                                | INTEGER | NOT NULL DEFAULT 0     | 越大越优先                                               |
| `idempotency_key`                         | TEXT    | UNIQUE NOT NULL        | 逻辑幂等键                                               |
| `concurrency_key`                         | TEXT    | NULL                   | 活动任务互斥键                                           |
| `source_id`、`source_run_id`              | TEXT    | NULL                   | 执行输入中的来源和扫描身份查询投影                       |
| `attempt_count`                           | INTEGER | NOT NULL DEFAULT 0     | 已领取次数                                               |
| `available_at`                            | INTEGER | NOT NULL               | 最早执行时间                                             |
| `lease_owner`                             | TEXT    | NULL                   | Worker ID                                                |
| `lease_expires_at`、`last_heartbeat_at`   | INTEGER | NULL                   | 租约和心跳                                               |
| `cancel_requested_at`                     | INTEGER | NULL                   | 运行中取消请求                                           |
| `error_category`、`error_summary`         | TEXT    | NULL                   | 最后错误                                                 |
| `created_at`、`started_at`、`finished_at` | INTEGER | NOT NULL / NULL / NULL | 生命周期时间                                             |

领取索引：`(task_type, status, available_at, priority DESC, created_at)`；恢复索引：`(status, lease_expires_at)`；部分唯一索引 `concurrency_key WHERE status IN ('pending', 'running')`。

`public_state` 只保存任务的小型结构化结果或结果 ID，不复制大型文档。简历润色结果由 `agent_runs.output_json` 保存，任务结果只保存 `agentRunId` 等定位字段。

#### 3.5.2 周期设置

调度定义和下一次入队进度保存在 `application_settings` 的 `task.periodic:<scheduleKey>` 设置中，以下是 value_json 的属性，不再建立 schedules 表。运行时通过 JSON 表达式部分索引查找到期设置，使用 CAS 原子推进下一次触发时间并发布任务。

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

`sources.scheduleOverrides` 保存以物理来源 UUID 为键的独立计划（cron、时区、启停）；未设置时沿用全局计划。全局同步开关、频率或时间变化时清空覆盖项，其他偏好变化和重启不清空，无需新增表或迁移历史运行记录。

| 列               | 类型    | 约束     | 说明                        |
| ---------------- | ------- | -------- | --------------------------- |
| `key`            | TEXT    | PK       | Registry 声明的非敏感设置键 |
| `value_json`     | TEXT    | NOT NULL | 已校验设置值                |
| `schema_version` | TEXT    | NOT NULL | 设置 Schema 版本            |
| `updated_at`     | INTEGER | NOT NULL | 修改时间                    |

未知 key 一律拒绝。密钥只从环境变量或密钥环读取。

### 3.6 面试准备

本领域包含简历项目拷打、个人面经和网友面经研究。项目代码不进入数据库；深档只读取用户显式上传并冻结的 Markdown 版本，外部研究 Agent 只接收岗位 Brief、Prompt 与输出 Schema。

**事务边界：**创建 AI 会话、追加消息及发布回复任务使用短事务。模型调用在事务外执行，提交前检查当前消息和可选项目事实未变化；用户编辑覆盖当前内容并取消未完成回复。个人面经草稿及审核继续使用 revision CAS；研究的执行与导入检查点由 tasks 承载。

#### 3.6.1 本地项目关联

项目事实使用当前画像 projects_json，稳定 id 保持编辑、排序后的身份，local_path 仅记录本地位置。系统不上传、复制或自动扫描项目目录。project_dossiers、resume_project_snapshots、项目材料和备忘录管理已移除；项目删除只解除会话关联。

#### 3.6.3 通用会话与消息

- ai_sessions：id、type（interview/chat）、title、created_at、updated_at。会话无暂停、完成或截止状态。
- ai_messages：id、session_id（级联删除）、role、content、sequence、status（pending/completed/failed/cancelled）、created_at、updated_at。session_id/sequence 唯一，每会话最多一条 pending 消息。编辑 user 消息覆盖当前值，通过 updated_at 检查并发，不保留回答修订。
- ai_session_metadata：独立 id、session_id、name、value、created_at、updated_at；session_id/name 唯一。profile_id、project_id 为可选关联，失效后对话仍可继续。
- model_requests.ai_message_id：可空外键指向 assistant 消息，一条消息可对应协商、重试等多次请求；消息删除置空，账本保留。非对话请求为空。

0058 将旧问题及每题最新回答分别迁为消息，保留确定顺序；移除 drill_sessions、drill_turns、drill_answer_revisions、project_knowledge_items 和覆盖状态。旧任务停止分派，旧派生摘要不保留回答历史。对话 Agent 不缓存或另存输出，任务输入只保存会话及消息 ID；模型返回后在事务内检查输入指纹，拒绝被编辑或取消的迟到回复。

0059 删除旧项目档案与系统材料索引；0060 将研究请求迁入 tasks。旧项目 API 和界面实现已删除。

#### 3.6.8 `interview_experiences`

个人面经或研究包中的有序面试经历。文档状态、解析文本和警告保存在对应 `files` 与当前 `file_entity_mappings`；`source_type` 和约束保证网友内容不会被当成用户事实。

| 列                                           | 类型    | 约束                         | 说明                                              |
| -------------------------------------------- | ------- | ---------------------------- | ------------------------------------------------- |
| `id`                                         | TEXT    | PK                           | 经历 ID                                           |
| `file_id`                                    | TEXT    | FK files, NOT NULL           | 个人面经文件或研究 Bundle 逻辑文件                |
| `sequence_no`                                | INTEGER | NOT NULL CHECK >= 1          | 文件内顺序                                        |
| `source_type`                                | TEXT    | CHECK `personal/community`   | 来源边界                                          |
| `review_status`                              | TEXT    | CHECK                        | draft、needs_review、accepted、rejected           |
| `research_task_id`                           | TEXT    | FK tasks, ON DELETE SET NULL | 网友候选所属请求；个人经历必须为空                |
| `company`、`role`、`stage`                   | TEXT    | NULL                         | 公司、岗位和阶段                                  |
| `occurred_on`                                | TEXT    | NULL CHECK 日期格式          | 面试日期                                          |
| `outcome`、`difficulty`                      | TEXT    | NULL                         | 仅个人面经使用的结果和难度                        |
| `tags_json`                                  | TEXT    | NOT NULL DEFAULT `'[]'`      | 标签                                              |
| `notes`                                      | TEXT    | NULL                         | 未分类过程备注                                    |
| `source_url`、`source_title`                 | TEXT    | community 时 NOT NULL        | 公开来源                                          |
| `source_published_at`、`source_retrieved_at` | TEXT    | NULL / community 时 NOT NULL | 来源发布与检索时间                                |
| `verification_status`                        | TEXT    | CHECK                        | personal 为 not_applicable；首版网友为 unverified |

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
| `question_fingerprint`      | TEXT    | NULL CHECK SHA-256                 | 规范问题指纹，用于独立来源计数         |
| `question_source_start/end` | INTEGER | 成对为空或合法范围                 | 问题在规范文本中的证据范围             |
| `answer_source_start/end`   | INTEGER | 成对为空或合法范围                 | 回答在规范文本中的证据范围             |

唯一约束：`(experience_id, sequence_no)`。人工修改内容时清除对应自动解析范围，避免错误指向原文。

#### 3.6.10 面经研究阶段任务

不再保留 experience_research_requests 表。tasks 中 interview.experience-research 父任务保存冻结 Brief、Prompt/Schema 引用、导入检查点和 CAS 修订；private_state.research 归 user 模块解释，public_state 只包含阶段和候选数。等待外部结果时父任务不占执行器，系统采集由关联的 interview.experience-research.execute 子任务承担。任务页链接到研究工作台，执行子任务可单独取消和重试。

输出位置由数据根目录与父任务 ID 决定：research-results/<taskId>/result.json，重定位数据目录后自动重算。外部 Agent 在指定位置交付；系统执行器原子写入同一位置后走同一校验。拒绝非普通文件、符号链接、无效 UTF-8/JSON、错误指纹和超过 2 MiB 的内容。重复检查相同字节保留候选身份及审核状态；新内容受修订号与导入声明保护，已接受内容不得覆盖。

导入成功即将父任务标记 succeeded，后续审核只更新面经记录和审核修订，不改变执行完成状态。来源关联 research_task_id 为可空外键，删除任务不删除面经或问题。Prompt/Schema/有效 Bundle 继续通过通用文件存储留存，输入输出不在数据库事务内读取或生成。

### 3.7 通用文件与事件基础设施

本领域只提供跨领域稳定能力，不承载业务实体本身。

**事务边界：**实体去重、逻辑文件和版本关联在同一事务登记；业务引用尽可能在同一个数据库事务提交。事件必须与引发它的当前态更新同事务。文件物理隔离与数据库删除使用补偿流程。

#### 3.7.1 `files`

业务引用的逻辑文件身份，独立于具体物理内容版本。

| 列                         | 类型    | 约束                    | 说明                                                               |
| -------------------------- | ------- | ----------------------- | ------------------------------------------------------------------ |
| `id`                       | TEXT    | PK                      | 逻辑文件 ID                                                        |
| `kind`                     | TEXT    | NOT NULL                | Registry 类型：resume、interview_experience、interview_research 等 |
| `name`                     | TEXT    | NOT NULL CHECK 非空     | 安全显示名称，不解释为本地路径                                     |
| `state`                    | TEXT    | NOT NULL                | 类型相关状态，由 kind 对应 Schema 校验                             |
| `revision`                 | INTEGER | NOT NULL DEFAULT 0      | 可编辑逻辑文件 CAS 修订号                                          |
| `properties_json`          | TEXT    | NOT NULL DEFAULT `'{}'` | 类型相关低频元数据                                                 |
| `created_at`、`updated_at` | INTEGER | NOT NULL                | 生命周期时间                                                       |

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

### 3.8 招聘邮件与申请跟踪

本领域保存最小消息引用、求职申请当前态和专用申请事件。邮箱账号及非敏感设置位于本地配置文件，增量游标和健康状态位于 `<dataRoot>/mail/runtime-state.json`；SQLite 不承担邮箱连接配置、游标、待确认分类快照或完整邮件归档。

**文件状态边界：**本地配置保存稳定 `mailboxKey`、provider、脱敏地址、`credentialRef`、文件夹、回溯、计划和模型开关；运行状态按邮箱和文件夹保存连接器版本、代次、不透明游标、最近成功/失败时间及固定错误类别。运行状态先写同目录临时文件再原子替换，不保存授权秘密或邮件内容。

**凭据文件边界：**凭据保存到独立 AES-256-GCM 文件 `<dataRoot>/mail/credentials.enc.json`，密钥位于独立文件 `<dataRoot>/mail/credentials.key` 或来自环境主密钥；每条记录使用随机 IV 和绑定引用的 AAD。普通备份排除密文与密钥，Web 是首版唯一凭据写入者。详见 [ADR-0056](../adr/0056-encrypted-mail-credential-file.md)。

**事务边界：**每个增量页在短事务内保存消息引用并发布分类任务，提交成功后才推进文件游标；若游标写入前崩溃，下次整页重放并由唯一约束消重。单邮件自动接受或用户确认时，在一个短事务内更新消息结论、追加申请事件并更新申请当前态；待确认详情的重新读取、MIME 清洗和分类均在事务外完成。凭据写入、撤销、文件原子替换和提供商网络请求也不进入数据库事务。

#### 3.8.1 `mail_message_refs`

保存幂等、重新获取、来源定位和当前处理状态所需的最小消息身份，不承担邮件正文、中间分类结果或分类历史归档。

| 列                                         | 类型    | 约束        | 说明                                                                       |
| ------------------------------------------ | ------- | ----------- | -------------------------------------------------------------------------- |
| `id`                                       | TEXT    | PK          | 内部消息引用 ID                                                            |
| `mailbox_key`                              | TEXT    | NOT NULL    | 本地配置中的稳定邮箱键；配置删除后仍用于来源追溯                           |
| `provider_key`                             | TEXT    | NOT NULL    | 连接器 Registry key                                                        |
| `external_message_key`                     | TEXT    | NOT NULL    | 邮箱内稳定消息键                                                           |
| `thread_key_hash`                          | TEXT    | NULL        | 可选线程身份哈希                                                           |
| `source_url`                               | TEXT    | NULL        | 不含凭据或一次性令牌的可选 `https` 原邮件入口，不作为身份键                |
| `received_at`                              | INTEGER | NOT NULL    | 提供商接收时间                                                             |
| `content_version`                          | TEXT    | NOT NULL    | 提供商版本、etag 或连接器内容代次                                          |
| `content_hash`                             | TEXT    | NULL        | 正文清洗后内容哈希，尚未读取时为空                                         |
| `processing_status`                        | TEXT    | CHECK       | `discovered`、`candidate`、`accepted`、`needs_review`、`ignored`、`failed` |
| `last_classifier_kind`                     | TEXT    | CHECK, NULL | 最近分类器：`rules`、`agent`                                               |
| `last_classifier_version`                  | TEXT    | NULL        | 最近自动分类策略版本                                                       |
| `last_seen_at`、`created_at`、`updated_at` | INTEGER | NOT NULL    | 观察和生命周期时间                                                         |

唯一约束：`(mailbox_key, external_message_key)`；索引：`(processing_status, received_at)`、`(mailbox_key, received_at)`。`source_url` 通过运行时 Schema 限制为不含授权凭据或一次性访问令牌的 `https`，不能由 Worker 自动打开，其查询参数不得进入日志或诊断。`needs_review` 和 `ignored` 记录都不得保存主题、发件地址、正文、结构化提取或证据；待确认详情必须按消息引用重新读取。

#### 3.8.2 `job_applications`

保存公司和岗位维度的申请当前投影。邮件中岗位不必先存在于职位库。

| 列                              | 类型    | 约束               | 说明                                                                                             |
| ------------------------------- | ------- | ------------------ | ------------------------------------------------------------------------------------------------ |
| `id`                            | TEXT    | PK                 | 申请 ID                                                                                          |
| `company_id`                    | TEXT    | FK companies, NULL | 能明确映射时的公司                                                                               |
| `job_id`                        | TEXT    | FK jobs, NULL      | 用户确认的正式职位关联                                                                           |
| `external_application_key_hash` | TEXT    | NULL               | 提供商申请编号的不可逆规范身份                                                                   |
| `company_name`                  | TEXT    | NOT NULL           | 邮件或用户确认的公司显示名                                                                       |
| `role_title`                    | TEXT    | NOT NULL           | 邮件或用户确认的岗位名称                                                                         |
| `status`                        | TEXT    | CHECK              | `unknown`、`applied`、`assessment`、`interview`、`offer_intent`、`offered`、`rejected`、`closed` |
| `status_effective_at`           | INTEGER | NULL               | 当前状态的有效时间                                                                               |
| `revision`                      | INTEGER | NOT NULL DEFAULT 0 | 状态投影和关联更新的并发版本                                                                     |
| `created_at`、`updated_at`      | INTEGER | NOT NULL           | 生命周期时间                                                                                     |

索引：`(status, updated_at DESC)`、`(company_id, role_title)`、`job_id`、`external_application_key_hash`。仅凭公司和岗位不建立唯一约束；同一公司可以存在多个同名申请，合并必须有明确申请编号、线程证据或用户确认。

#### 3.8.3 `application_events`

保存按申请有序的招聘流程事件。该表承担外键、排序、状态投影和时间线查询，不使用通用 `events` 替代。

| 列                    | 类型    | 约束                           | 说明                                                     |
| --------------------- | ------- | ------------------------------ | -------------------------------------------------------- |
| `id`                  | TEXT    | PK                             | 申请事件 ID                                              |
| `application_id`      | TEXT    | FK job_applications, NOT NULL  | 所属申请                                                 |
| `sequence_no`         | INTEGER | NOT NULL CHECK >= 1            | 申请流内序号                                             |
| `mail_message_ref_id` | TEXT    | FK mail_message_refs, NOT NULL | 稳定邮件来源                                             |
| `source_content_hash` | TEXT    | NOT NULL                       | 产生事件的清洗内容哈希                                   |
| `source_event_no`     | INTEGER | NOT NULL CHECK >= 1            | 一封邮件包含多个事件时的稳定序号                         |
| `acceptance_kind`     | TEXT    | CHECK                          | `automatic`、`user_confirmed`                            |
| `classifier_kind`     | TEXT    | CHECK                          | `rules`、`agent`                                         |
| `classifier_version`  | TEXT    | NOT NULL                       | 规则或 Agent/Prompt 版本                                 |
| `agent_run_id`        | TEXT    | FK agent_runs, NULL            | 使用模型时的运行引用                                     |
| `event_type`          | TEXT    | NOT NULL                       | 029 规格定义的申请事件类型                               |
| `effective_at`        | INTEGER | NOT NULL                       | 事件业务有效时间                                         |
| `received_at`         | INTEGER | NOT NULL                       | 邮件接收时间                                             |
| `confidence`          | REAL    | NOT NULL CHECK 0..1            | 自动分类置信度；用户确认不修改原始置信度                 |
| `payload_json`        | TEXT    | NOT NULL DEFAULT `'{}'`        | 公司、岗位、时间原文、时区来源、地点、链接和有界字段证据 |
| `created_at`          | INTEGER | NOT NULL                       | 入库时间                                                 |

唯一约束：`(application_id, sequence_no)`；邮件来源事件唯一约束 `(mail_message_ref_id, source_content_hash, source_event_no)`。分类器版本变化不能绕过邮件事实唯一约束制造重复事件。只有 `automatic` 或明确 `user_confirmed` 的事件能在同一事务更新 `job_applications.status`；`needs_review` 和 `ignored` 消息不能创建申请事件。

## 4. 跨领域事务设计

| 用例           | 同一事务内必须完成                                                            | 事务外工作与失败恢复                                                      |
| -------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 开始同步       | 创建 `tasks(source.scan, running)`                                            | HTTP 和浏览器抓取在提交后执行                                             |
| 首次发现职位   | `jobs`、`job_observations`、`sync_seen_jobs`、状态事件                        | 解析与标准化先完成并校验                                                  |
| 职位内容变化   | 更新 `jobs` 当前内容、失效派生结果、新增观察和已见标记                        | 无原始响应落库；失败整项回滚                                              |
| 重复观察       | 新增观察和已见标记、更新 `last_seen_at`                                       | 不创建修订                                                                |
| 职位状态变化   | 更新状态/缺失计数并追加 `job.status.changed`                                  | 完整性计算在事务前完成；可按职位批次提交                                  |
| 同步完成       | 更新运行状态、覆盖证据、统计和游标                                            | 仅在所有缺失推进批次完成后标记成功                                        |
| Task 领取      | pending → running、租约、尝试次数 CAS                                         | Handler 在事务外执行                                                      |
| Task 成功      | running → succeeded、`result_json`、完成时间                                  | 输出先通过 Handler Schema；租约丢失则不提交                               |
| 发布面试 Task  | 创建 pending Task，并关联 turn 或 ResearchRequest                             | payload 在事务前校验；失败整体回滚，不暴露未关联 Task                     |
| 重试面试 Task  | 创建 retry Task，并把业务引用从旧 failed Task 原子切换到新 Task               | 业务状态已变化则拒绝重试，新 Task 不得抢跑                                |
| Agent 执行     | 分别原子创建 running 和提交终态                                               | 模型调用在两次事务之间；崩溃由缓存和任务重试恢复                          |
| 导入文档       | 文件、实体、版本及首个业务引用的数据库登记                                    | 临时文件写入、解析在事务外；失败产生的孤立文件延迟清理                    |
| 保存面经草稿   | 文件 revision CAS，替换经历和问题                                             | 旧 revision 返回冲突，不部分更新                                          |
| 登记项目资料   | 逻辑文件新版本、解析元数据与 dossier revision                                 | Markdown 校验、规范化和分块在事务外                                       |
| 开始深档拷打   | 重验 1–8 个当前资料版本并冻结 session bindings、初始化覆盖状态                | 不读取项目目录；问题片段在 Worker 执行期按冻结版本选择                    |
| 恢复拷打会话   | 暂停同档案当前 active 会话、激活目标会话并递增双方上下文修订号                | 切换前拒绝仍有待处理任务的当前会话；列表按最后修改时间重新排序            |
| 导入研究包     | claim/finalize 均核验当前 running 且未取消的 Task；提升 mapping、CAS 替换候选 | JSON/Schema/URL 校验和 staging Bundle 文件写入在事务外；失败/过期补偿清理 |
| 审核网友面经   | 单条候选状态、request revision 与聚合状态 CAS                                 | 外部链接不在事务中访问                                                    |
| 提交邮箱增量页 | 新增/更新 `mail_message_refs` 并发布分类 Task                                 | 邮箱请求和头部校验在事务外；提交成功后原子替换文件游标，崩溃时整页重放    |
| 分类招聘邮件   | 更新消息结论、追加申请事件并更新 `job_applications` 当前投影                  | 正文获取、MIME/HTML 清洗、规则和模型调用在事务外；输出先通过 Schema       |
| 确认招聘邮件   | 重验瞬时分类结果和目标申请、追加申请事件并更新消息状态与申请当前投影          | 重新读取和分类在事务外；首版只允许确认、忽略或选择申请，不允许修改字段    |
| 断开邮箱       | 删除或停用本地配置、停止计划并登记稳定删除影响                                | 提供商撤销、凭据库删除和运行状态文件更新在事务外；失败保留可恢复错误状态  |
| 删除敏感文档   | 重验影响快照、删除业务引用和逻辑文件、追加审计事件                            | 先隔离独占物理实体；事务失败恢复，成功后清除                              |
| 推进计划       | 更新 周期设置的 `next_run_at` 并创建幂等 Task                                 | Cron 计算在事务前完成                                                     |

## 5. 关键跨表不变量

1. 每家公司恰好有三个逻辑渠道；每个物理来源只属于同公司的一个逻辑渠道。
2. 一个物理来源最多一个 `running` SyncRun，最多一个相同并发键的 pending/running Task。
3. 扫描阶段的 `public_state.coverage != complete` 时不得推进未观察职位的 `missing_count`。
4. `jobs.content_hash` 改变必须更新 content_id 并失效派生结果；状态改变必须追加事件。
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
16. 邮箱授权秘密只存在 AES-256-GCM 加密凭据文件；本地配置只能保存不可直接授权的 `credentialRef`，凭据值不得出现在 SQLite、运行状态、任务、事件、日志或普通备份中。IMAP 授权码仅允许在设置页用户主动触发时通过无缓存接口临时回传，OAuth 令牌不得回传。
17. 同一稳定邮箱键的 `external_message_key` 唯一；增量页的数据库提交成功后才能推进文件游标，游标未推进只允许造成可安全消重的重复读取。
18. 邮件来源申请事件必须引用对应 `mail_message_refs`，并以消息引用、内容哈希和邮件内事件序号保持唯一；分类器版本变化不能制造重复事实。
19. 申请事件与申请当前态在同一事务提交；待确认或忽略消息不能推进状态。首版不允许修改分类字段、既有事件或追加人工事件。
20. 邮件事件可以选择性关联职位，但不能更新 `jobs`、`job_observations`、来源健康或职位匹配结果。

## 6. 保留、清理与备份

- `jobs` 默认长期保留；`job_observations` 默认保留 180 天。
- 不保存完整原始职位响应；`source_job_details` 是可重建缓存，默认最多保留 30 天未命中记录，失败缓存可以更短。
- `sync_seen_jobs` 在运行完成后清理；异常退出的工作集由恢复任务清理。
- `events` 按事件类型保留：职位生命周期和敏感删除审计长期保留；同步失败与 Agent 工具诊断可随其运行保留策略清理。
- Agent 成功结果按被引用关系保留；无引用失败/取消运行可按期限清理。
- 简历、个人面经和项目资料只允许通过所属聚合的显式删除流程清理；删除前展示稳定影响快照。
- 研究 Prompt、Schema 与最多五版有效 Bundle 随研究请求保留；网友面经只长期展示人工接受项，拒绝项可按后续显式保留策略清理。
- 邮箱原始 MIME、完整 HTML、普通附件和无关邮件正文不保存；`ignored` 邮件引用默认保留 180 天用于回溯去重，超过窗口且不被任务引用时可清理。
- 招聘邮件引用、申请和申请事件随用户申请历史保留，只有显式删除邮箱派生数据或申请时清理；断开邮箱并保留时间线不能级联删除这些事实。
- 邮箱密文和密钥不属于普通备份范围；备份可包含非敏感配置和运行状态。跨机器迁移需通过独立安全通道传输密文与对应密钥，或配置相同环境主密钥。恢复后若 `credentialRef` 不可用，对应邮箱进入 `auth_required`，重新授权前不得发布读取任务。
- 文件实体失去最后引用后先隔离，数据库提交成功后清除；24 小时以上的未登记孤立文件可以清理。
- 备份先使用 SQLite Online Backup API 创建一致性快照，再从快照读取活动 `entities` 清单并复制、校验 SHA-256。
- 恢复要求 CLI、Worker 和 Web 停止，在临时目录验证数据库、实体哈希和外键后原子切换。

## 7. 表审计结论

### 7.1 目标业务表清单

在现有 33 张目标业务表基础上，招聘邮件能力新增 3 张专用表，目标模型共 36 张业务表：

| 领域           | 表                                                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------------------- |
| 来源目录与同步 | `companies`、`source_channels`、`job_sources`、`source_job_details`、`sync_seen_jobs`                      |
| 职位事实       | `jobs`、`job_observations`                                                                                 |
| 候选人画像     | `candidate_profiles`、`profile_versions`                                                                   |
| Agent 与匹配   | `agent_runs`、`job_metadata`                                                                               |
| 任务与设置     | `tasks`、`application_settings`                                                                            |
| 面试准备       | `ai_sessions`、`ai_messages`、`ai_session_metadata`、`interview_experiences`、`interview_question_entries` |
| 招聘进展       | `mail_message_refs`、`job_applications`、`application_events`                                              |
| 通用基础设施   | `files`、`entities`、`file_entity_mappings`、`events`                                                      |

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
- 会话消息是交互事实，不保存十维覆盖或二次知识提取；模型上下文策略另行设计。
- 面经研究及阶段检查点使用 tasks，人工审核属于 interview_experiences；任务清理不删除业务面经。
- `interview_experiences` 和 `interview_question_entries` 是受约束的领域实体，不应退化为文件 JSON。
- `application_events` 需要申请外键、流内顺序、稳定邮件来源约束和高频时间线查询，不能退化为通用 `events` 的多态 JSON。
- `mail_message_refs` 是增量幂等、来源定位和正文按需重取所需的最小记录，不是原始邮件、中间分类结果或分类历史归档；无关和待确认邮件的主题、地址与正文不能借该表保留。

## 8. 迁移与验证要求

数据库收敛迁移必须按“创建新结构、复制、验证、切换引用、删除旧结构”的顺序执行，并满足：

1. 空库初始化成功，业务表清单与第 7.1 节完全一致。
2. 从上一正式 Schema 升级不丢失职位修订、观察、简历、面经、项目拷打、任务、Agent 和匹配数据。
3. `raw_job_records` 删除前，将被修订使用的来源哈希和 URL 回填到 `jobs`，观察通过 `job_id` 关联职位。
4. FTS 虚表、shadow tables 和同步触发器全部删除，关键词查询回归测试覆盖 `%`、`_` 和转义符。
5. 旧文档表正确映射到逻辑文件、物理实体和版本；共享内容只生成一个活动物理实体。
6. 第六个文件实体版本被数据库拒绝；删除共享逻辑文件不影响其余引用。
7. 四类旧事件完整迁入 `events`，流内序号稳定且唯一。
8. 迁移完成后通过 `PRAGMA foreign_key_check`、`PRAGMA integrity_check` 和主要 Repository 集成测试。
9. 备份、清理和 doctor 只识别新模型，不引用已删除对象。
10. 旧浅档会话迁入后绑定数组为空；深档资料登记、五版本上限和冻结版本读取通过集成测试。
11. 旧个人面经保持 `personal` 来源语义；网友候选的回答摘录与用户回答分列保存，只有 accepted community 记录进入网友面经读取模型。
12. `0022` 保证同一档案同名项目资料只有一个逻辑文件；`0023` 的 Bundle claim、staging 提升、失败补偿、过期回收和第五/第六版本边界必须通过双连接集成测试。
13. 招聘邮件迁移创建三张新表和全部 CHECK、唯一、外键及索引；空库与从上一正式 Schema 升级都不得生成默认邮箱配置或伪造申请事件。
14. 邮箱同步集成测试证明消息引用与分类任务原子提交、运行状态文件原子替换；数据库提交后崩溃造成的重复页和租约恢复不产生重复申请事件。
15. 加密凭据文件、邮箱配置、运行状态与数据库备份恢复测试证明秘密不进入 SQLite 或普通备份；恢复后凭据引用不可用的邮箱为 `auth_required`，既有申请时间线仍可查询。

本文是目标设计，当前代码与迁移在完成实现和全部验证前不得标记为 Accepted。

JobAdvice v3 的 MatchAdvice 与对应 AgentRun 输出仅包含亮点、缺口、待确认项和准备建议，不再保存引用编号、引用明细或简历重点。0047 数据迁移清理旧结构并重算内容哈希，保留原记录和运行身份；新 Agent 版本隔离旧格式缓存。

# 当前职位与派生信息

职位当前事实归 recruitment 的 jobs；matching 使用 job_metadata(id, job_id, name, value, created_at, updated_at)，按 (job_id, name) 唯一保存当前解析、评分和建议。规则配置由代码常量提供，不再持久化规则集。评分明细压缩为分项分数、风险规则标识、未知规则标识及独立模型分数和理由。内容身份与输入摘要负责过期检测，不保存历史职位快照。
