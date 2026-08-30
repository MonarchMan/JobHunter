# ADR-0013：深档文档取证与本机 Codex 面经研究执行

> 状态：Accepted（第 5、7 项已被 ADR-0014 部分取代）
> 日期：2026-08-30
> 部分取代：ADR-0010 的第 6、8 项

## 背景

ADR-0010 确立了面试准备与外部 Agent 的边界，但当时将自动外部执行暂缓，并预计用 SQLite FTS5 检索项目资料。后续数据库收敛已根据 ADR-0012 删除全部 FTS 对象；产品也明确要求在本阶段同时完成“深档项目文档拷打”和外部 Agent 网友面经研究的实际闭环。

首版资料集合仅是用户显式上传的少量 Markdown，不需要全文引擎或向量数据库。外部研究则需要一个可用的本机执行适配器，但不能让供应商 CLI 直接获得业务仓储或成为手工 Prompt/Bundle 路径的前置依赖。

## 决策

1. 深档只接受用户在项目档案中显式上传的 UTF-8 Markdown/MDX，不接收目录，不发现或扫描源码。资料复用 `files → file_entity_mappings → entities`，同名逻辑文件最多五个版本，会话冻结精确的 file/version/entity/hash 绑定。
2. Markdown 在应用边界规范化并按标题保存带哈希的字符范围。问题生成前使用有上限的应用内关键词排序选择片段；不使用 FTS5、向量库或通用 RAG 框架。
3. 深档问题 Agent 保持空工具集。应用层只把已选文件的有界纯文本片段放入结构化输入；输出至少引用一个真实 `project_material` 分块，且再次通过冻结绑定、范围和哈希校验。
4. 网友面经研究使用业务级 `ExperienceResearchRequest` 保存长期意图，使用通用 `Task` 保存某次执行，Prompt、JSON Schema 和 Bundle 全部使用通用文件实体。预览与执行读取请求冻结的 Prompt/Schema 精确版本；手工导入与自动执行共用同一条严格 Bundle 校验、规范化、去重和人工审核管线。
5. 首个自动适配器为 `codex-local@v1`，仅由 Worker 注册真实 Handler。它在隔离临时目录中以非交互、ephemeral、read-only sandbox 和实时网页搜索参数启动 Codex，通过 stdin 传 Prompt，仅继承运行所需的最小环境，对进程输出、结果文件、超时和取消设固定上限，并保证同一 Worker 最多一个 Codex 研究进程。适配器使用 strict config，仅保留原生网页搜索并禁用 Shell、统一执行、浏览器自动化、Computer Use、多 Agent/Goal、授权请求、插件、App、Skill、本地图片和工作区依赖工具；运行中的 Codex 不支持这些限制时拒绝执行。
6. Web 和 CLI 只注册不可执行的 Handler 以供入队、校验和重试解析，不启动外部进程。本机 Codex 不可用时，用户仍可下载 Prompt/Schema 并人工导入 Bundle。
7. Codex 官方沙箱语义中的 read-only 仍允许检查文件，因此不能单独作为读取隔离；工具禁用与最小输入共同限制模型侧本地读取面。该适配器仍是可信本机上的受限进程，不宣称具有容器或 OS 级根目录隔离。JobHunter 不把工作区、数据库路径、完整简历、个人回答或密钥值传入外部任务。
8. 同一规范 Brief 的尚可替换请求幂等复用。当已有接受项或 Bundle 达到五版时，以基础指纹和下一 generation 派生新实例指纹，保留旧请求与来源历史。
9. Bundle 导入先以 request revision 取得短租约 claim，再在事务外写本次 claim 独占的 staging 逻辑文件，最后在短事务中把 staging mapping 提升为 canonical Bundle 版本并替换候选；失败和过期 claim 必须补偿清理，不能消耗五版额度。
10. 面试问题、回答摘要和外部研究 Task 的首次发布必须在同一 SQLite 短事务中完成 Task 入队和业务聚合关联；手工重试必须原子把关联从失败 Task 切换到新 Task。幂等或并发返回必须核验精确任务意图和聚合当前引用。Handler 最终提交必须以当前 Task ID、`running` 状态和未取消条件门控；若业务提交先于取消请求，Task 完成为 succeeded，不能把已发布结果标成 cancelled。回答已提交但摘要 Task 尚未发布的崩溃间隙，由相同回答幂等 token 恢复发布。Markdown 投影为每个 dossier revision 创建独立幂等 Task，生产 Worker 固定单消费者串行处理，旧 revision 以 CAS 失效，不能阻断最新 revision；Artifact 已写入但 CAS 失败时注销未引用的存储元数据并交由 orphan cleanup 清除物理文件。

## 影响

- 个人规模的 Markdown 资料可以用少量表和确定性逻辑完成可追溯取证，数据库不再承担 FTS shadow tables 与同步触发器的运维代价。
- 新资料版本不会改变已开始会话；删除 dossier 必须把其资料逻辑文件和未共享物理实体纳入影响快照与补偿流程。
- 自动研究体验更完整，但需要本机 Codex 已安装且已登录；失败只影响该 Task，不阻断手工交接。
- 公开网页内容仍属未信任外部陈述，Schema 通过不代表真实性通过；只有用户明确接受的条目才进入网友面经读取模型。

## 备选方案

- **重新引入 FTS5**：对少量显式资料收益不足，且会恢复已删除的内部对象与同步复杂度，拒绝。
- **直接让内部 Agent 读取项目目录**：会扩大产品责任和私密边界，拒绝。
- **只保留手工 Prompt 交接**：最简单，但本阶段已要求可用的外部 Agent 闭环，仅作为降级路径保留，不再是唯一路径。
- **让 Codex 直接写 SQLite 或业务文件**：会绕过业务校验、CAS 和人工审核，拒绝。
