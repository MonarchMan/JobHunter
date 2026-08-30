# ADR-0012：删除原始职位归档与 FTS 并固定文件实体命名

> 状态：Accepted
> 日期：2026-08-30

## 背景

ADR-0011 已决定收敛事件和文件表，但仍保留 `raw_job_records`，并采用 `file_entities`、`file_entity_versions` 命名。后续严格审计确认：完整原始职位响应没有稳定读取价值，FTS5 在当前规模下带来的虚表、shadow tables 和同步触发器成本高于收益；文件表名称也应直接表达“物理实体”和“映射”。

## 决策

1. 删除 `raw_job_records`。`job_revisions` 保存 `source_payload_hash`、`source_url` 和标准化快照；`job_observations` 引用当时生效的 `job_revision_id`。
2. 删除 `jobs_fts`、其 shadow tables 和三个同步触发器。关键词查询在 `jobs` 上使用转义后的 `LIKE`；只有真实基准证明需要时才能通过新 ADR 恢复全文索引。
3. 通用文件模型固定为 `files`、`entities`、`file_entity_mappings`；每个逻辑文件最多映射五个物理实体版本。
4. 删除 `job_sources.recruitment_type`，招聘渠道以 `channel_id` 指向的 `source_channels.channel` 为唯一事实。

## 后果

- 不再承诺恢复或重放历史官网完整响应；迁移只从旧记录回填修订所需的来源哈希和 URL。
- 同步失败事件保存来源 URL 和脱敏错误，不保存原始记录 ID。
- 同步链路不再为原始职位调用文件存储，减少数据库与文件系统写入。
- 职位关键词搜索为线性文本匹配；数据规模显著增长后需以基准决定是否重新引入索引。

## 取代关系

本 ADR 取代 ADR-0011 中关于文件表命名、原始职位归档保留和迁移无损范围的相关结论；通用事件及逻辑文件—物理实体分离决策继续有效。
