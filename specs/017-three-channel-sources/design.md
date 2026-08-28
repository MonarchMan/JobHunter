# 017 官网三渠道来源设计

> 状态：Implemented

> 演进说明：018 在不改写本规格历史实现的前提下新增 `SourceChannel`，并将本设计中的 source 明确为物理来源；三渠道矩阵迁移到逻辑渠道层。

## 模型

`FirstPartySourceSeed.source` 增加显式 `channel: intern | campus | social`。catalog 以三渠道矩阵为权威，数据库现有 `recruitment_type` 继续兼容：实习和校招写入 `campus`，社招写入 `social`；应用层频道展示读取显式映射结果。

每个公司保留现有 company UUID；新来源使用固定 source UUID。既有 source UUID 保留，但 016 中尚未发布且与真实频道不一致的 slug/key 会在本规格中 canonicalize：京东、华为的实习协议改用 `.intern`，字节跳动和拼多多修正 source slug，`netease.mixed` 改为三渠道来源；底层旧 adapter 只作为内部复用实现。

数据库迁移 `0014_canonical_source_channels` 在 catalog seed 前修正已有记录的 slug/key，保留 source UUID、运行时开关、健康状态、历史职位和任务关联；随后幂等 seed 新增缺失渠道。

## 不可用渠道

`shared/unavailable` 提供无网络的统一不可用适配器。它声明真实官网入口与公司信息，但 discovery/normalize 返回 `SourceError('access_blocked')`，health 为 `unhealthy`。该机制只表达事实状态，不生成岗位、不伪造 coverage，也不替代后续真实适配。

## Registry

真实适配器显式注册；catalog 中 `blocked` 且暂无真实实现的来源由 Registry 使用同一条 catalog 记录装配不可用适配器。Registry 测试保证所有 key 一一对应，不允许遗漏或额外 canonical key。

## 验证

新增 catalog 矩阵测试、blocked adapter 契约测试和 45 来源 seed 测试。已有来源契约继续覆盖真实协议；在线门禁仍按来源单独运行。
