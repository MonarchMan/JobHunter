# 002 SQLite 持久化任务

> 状态：Implemented
> 显式覆盖：PST-001, PST-002, PST-003, PST-004, PST-005, PST-006, PST-007, PST-008, PST-009, PST-010, PST-011, PST-Q01, PST-Q02, PST-Q03

- [x] **PST-T001** 安装并配置 Drizzle、better-sqlite3，建立 data root 与连接自检。（PST-001,002,003）
- [x] **PST-T002** 按 `docs/arch/data-model.md` 实现 Schema、CHECK、外键和索引。（PST-001）
- [x] **PST-T003** 创建初始迁移、FTS5 虚表/触发器和空库/重复迁移测试。（PST-001..003）
- [x] **PST-T004** 实现 UnitOfWork 与核心 Repository，并运行共享契约测试。（PST-004,005）
- [x] **PST-T005** 实现 ArtifactStore 的路径限制、原子写、哈希复用和失败清理。（PST-006）
- [x] **PST-T006** 实现职位结构化筛选、FTS 和游标分页测试。（PST-007）
- [x] **PST-T007** 实现非敏感 Settings Registry、Schema 校验和未知 key 拒绝。（PST-009）
- [x] **PST-T008** 实现“数据库快照 → 引用文件清单 → 哈希复制”、恢复独占连接检查及恢复后完整性检查。（PST-008,010）
- [x] **PST-T009** 添加上一 Schema 升级 fixture、并发 busy timeout 和事务回滚集成测试。（PST-Q01..03）
- [x] **PST-T010** 持久化职位理解系统设置，默认关闭并将现有来源同步策略迁移为关闭。（PST-011）
