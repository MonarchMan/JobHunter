# 032 四模块业务聚合设计

> 状态：Implemented

## 权威架构

模块职责与依赖边界见[总体架构](../../docs/arch/overall-arch.md)第 3.2、4.1 节。

## 组织方式

recruitment 和 user 按功能目录聚合领域模型、用例、Handler、Schema、Prompt 及仓储；只有存在实际复杂度时才在功能内建立 domain/application/adapters 子目录。matching 同时消费两者的公开契约。common 按通用运行能力分目录。目录不是新 workspace 包。

跨模块只导入公开 exports，包内不依赖根 barrel。业务领域仅依赖纯契约和纯基础抽象；业务用例声明仓储端口；同模块适配器实现端口，由 apps 装配。层级门禁应检查解析后的文件路径，不能因同处一包就允许应用用例导入 SQLite 实现。

## 数据与运行时

保留单体、CLI/Web 两个入口和单一 SQLite。将 apps/worker 实现迁入四模块：common 创建通用任务循环，各业务模块返回处理器、周期计划和资源释放；入口显式注入跨模块端口。Web 自动运行，CLI 等待命令按需运行并关闭，不保留独立 Worker 命令。业务表、仓储和迁移的所有权随业务模块；common 自己拥有任务、调度与通用运行记录。模块迁移清单由入口汇总为一个有序执行计划，不能独立重复执行同一历史迁移。历史迁移混合多个业务表时先登记一次性 legacy 清单，其拆分或移除必须单独评审，不在移动目录时改写历史 SQL。

matching 用自身输入端口隔离查询，apps 将 recruitment/contracts 和 user/contracts 的只读查询实现注入。持久化输入版本/哈希与算法版本，以便说明结果是否过期；不为了过期检测反向依赖 matching 或引入跨模块写表。

资料删除与版本保留使用同步事务参与者：user 声明派生数据清理端口，入口注入 matching 实现和 common 运行回收实现，并为所有参与者提供同一 SQLite 连接。user 只清理自身表，matching 只清理自身派生表；各所有者分别检查 Agent 引用后，由 common 回收无引用运行与对应审计。参与者不得调用外部服务或自行改变事务边界，确认快照和删除顺序沿用原有行为。

通用清理和平台保留策略同样由入口装配所有者参与者。common 只查询自身运行记录，招聘临时候选及用户/匹配引用分别由所属模块检查；平台删除在同一即时事务内重建引用保护快照，保持未知事件、在途任务、文件/训练绑定及匹配历史的保守保护。资源身份比较保留文本语义，数值型外部 ID 的嵌套 JSON 引用也必须阻止物理删除。

## 验证

页面验收使用 Playwright 启动真实 Next 服务，Web 容器必须经 getWebContainer 的实际运行配置加载迁移。全页面测试枚举 app 下 page.tsx，与固定验收清单逐项比较，并通过受身份门禁保护的隔离夹具创建动态页记录；不得用 API 单元测试或 404 页面替代真实页面可用性验收。

分阶段运行格式、类型、依赖边界和对应业务测试；完成阶段运行全仓及关键浏览器回归。浏览器、OCR、邮箱和模型入口继续分开导出，通过模块图测试证明契约导入不会加载这些实现。方案阶段执行文档格式与链接/需求覆盖检查，不以类型或测试通过宣称结构迁移完成。

## 迁移前盘点与旧数据边界

迁移前 workspace 有 16 个共享包；`domain` 与 `application` 分别被约 240 与 156 处源代码引用。原 `packages/db/src/schema/index.ts` 混合四类业务表，原 `packages/db/migrations/` 保存单一的历史迁移序列。此次迁移保持表名、列名、迁移编号和 SQLite 文件不变，没有重新初始化用户数据库或复制执行旧迁移。

| 归属         | 当前主要表或记录                                                                                                                                              | 后续代码迁移要求                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| recruitment  | companies、job_sources、sync_runs、jobs、job_revisions、job_observations、mail_message_refs、job_applications、application_events                             | 将来源、职位、邮箱和申请仓储归入招聘模块；邮箱凭据仍是独立加密文件，不能并入数据库 |
| user         | files、candidate_profiles、profile_versions、project_dossiers、drill_sessions、interview_experiences、interview_question_entries 等 | 文件存储机制可归 common，文件的简历语义和删除规则归 user；面试记录与画像同属 user  |
| matching     | job_enrichments、match_rulesets、match_results、match_advices                                                                                                 | 保留输入版本和结果历史，不因目录调整重算或覆盖原结果                               |
| common       | tasks、task_retry_logs、schedules、agent_runs、database_maintenance                                                                                           | 保留任务类型、任务 ID、累计尝试和租约语义；Worker Handler 注册顺序由入口明确管理   |
| 待拆的共享表 | entities、events、file_entity_mappings、application_settings                                                                                                  | 逐字段确认业务所有者；现阶段不移动存储定义或改写历史迁移                           |

历史 SQL 继续作为唯一 legacy 序列，由 common 的迁移执行器加载。只有新增迁移才按模块登记，入口合并后按全局版本顺序运行。首次代码迁移前对当前数据库做只读检查，记录表、迁移和数据量；任何涉及真实数据结构或内容的修改都必须单独提交具体方案，取得用户意见后执行。

迁移实施中确认：原 db 的 Drizzle Schema 声明未被运行时、测试、迁移执行器或生成脚本引用，仅从旧包根入口重导出。因此删除这份未使用的重复声明；SQLite 实际表结构仍由内容未变的 legacy SQL 定义与迁移集成测试验证，不新增另一套跨模块表定义。
