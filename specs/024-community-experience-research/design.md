# 024 外部 Agent 网友面经研究设计

> 状态：Implemented

## 1. 业务与运行边界

`ExperienceResearchRequest` 保存长期研究意图和审核状态；`Task` 保存某次外部执行；研究 Prompt、Schema 和 Bundle 都是 `files` 中的逻辑文件。外部 Agent 只实现应用端口，不进入内部 AgentRunner，也不能直接访问 Repository。

```text
ResearchRequest ──生成──► Prompt + JSON Schema
       │                         │
       ├──人工复制/导入──────────┤
       └──Task → codex-local─────┘
                                 ▼
                         ResearchBundle 校验
                                 ▼
                        needs_review 候选
                                 ▼ 人工接受/拒绝
                           网友面经读取模型
```

## 2. 数据模型

迁移 `0021_community_experience_research.sql` 新增 `experience_research_requests`，保存规范 Brief、请求指纹、Prompt/Schema 版本、三个逻辑文件引用、执行 Task、状态、失败摘要、修订号和时间。

`interview_experiences` 增加 `source_type`、`review_status`、`research_request_id`、来源 URL/标题/时间与核验状态；`interview_question_entries` 增加独立的 `answer_excerpt`、topics、有限 evidence excerpt 和问题指纹。网友摘录不得写入代表用户回答的 `answer`。个人面经插入为 `personal`，接受文档时同步其经历审核状态。网友候选的 `file_id` 指向当前研究包逻辑文件，不增加 `research_bundles` 文档表。

规范 Brief 先生成稳定基础指纹：同一 Brief 下尚可导包的未接受请求会幂等复用。当请求已有 accepted 候选或 Bundle 已达 5 版时，再次创建使用基础指纹与下一 generation 确定性派生新的实例指纹，既保留开放请求的幂等性，也不让已封存请求阻断同一研究目标的新一轮。

## 3. Bundle 校验与去重

领域层提供严格 `ResearchBundle@v1` Schema。应用层追加跨字段校验：请求指纹相等、experience.sourceUrl 存在于 sources、URL 仅 HTTP(S) 且无凭据、时间合法、摘录在固定长度内。规范 URL 去除 fragment；问题按 NFKC、空白折叠与小写生成指纹。同一 experience 内相同指纹保留首项，不跨来源合并原记录。

导入先用短 `BEGIN IMMEDIATE` 事务按 request revision 取得带 5 分钟租约的 import claim，再在事务外把 Bundle 写入本次 claim 独占的 staging 逻辑文件；最后在一个短事务中把 staging entity mapping 原子提升为 canonical Bundle 的下一版本、替换未审核候选并把请求置为 `needs_review`。自动路径在 claim 与 finalize 两个事务内都核验 `current_task_id`、Task 为 `running` 且未请求取消，跨进程取消一旦先取得写锁，候选和正式版本便不能提交；若 finalize 已先提交，之后抵达的取消视为过晚，Task 必须完成为 succeeded，不能出现候选可见而任务显示 cancelled。失败或租约过期会清理 staging 映射及无共享引用的实体；存在 accepted 候选或已达五个有效版本时在写正式版本前拒绝替换。

## 4. 外部执行器

应用端口 `ExternalResearchExecutor` 暴露 key/version/capabilities 与可取消 `execute`。首个 Node 适配器执行：

```text
codex --search --strict-config --ask-for-approval never
  --config shell_environment_policy.inherit=none
  --disable <each local-or-extensible feature>
  exec --ephemeral --skip-git-repo-check --ignore-rules --ignore-user-config
  --sandbox read-only --output-schema <isolated/schema.json>
  --output-last-message <isolated/result.json> -C <isolated-dir> -
```

Prompt 从 stdin 传入，不拼接 Shell 字符串。执行前从 Artifact Store 读取 ResearchRequest 冻结的 Prompt/Schema 精确版本，而不是用当前 renderer 重建。临时目录只含 Schema/结果，结束后清理；进程使用最小环境变量，stdout/stderr 只保留有上限的诊断摘要。AbortSignal 或超时终止整个进程组。

适配器逐项禁用 `shell_tool`、`unified_exec`、本地/外部浏览器自动化、Computer Use、`multi_agent`、Goal、授权请求、插件、App、Skill、本地图片和工作区依赖等本地或可扩展工具，只保留 `--search` 提供的原生实时网页搜索；`--strict-config` 使未知配置或 feature 直接失败。Codex 官方说明中，read-only 沙箱本身仍允许读取文件，因此这里不能只依靠 `--sandbox read-only`。适配器缺失、未登录、不支持所需限制、非零退出与无结果都映射为可诊断 Task 错误。该方案是可信本机上的受限本地进程，不宣称具备容器或 OS 级根目录隔离。

Web 进程注册不可执行 Handler 以校验/入队；生产 Worker 注册真实适配器。自动结果调用与手工上传相同的 Bundle Importer，因此不会形成旁路写库。

## 5. 审核与查询

审核以 request revision CAS 更新单个 experience 为 accepted/rejected，并重算 request 状态。网友面经列表只查询 accepted community records，支持按公司、岗位和阶段做大小写不敏感的精确筛选，并保留每条来源；通过 question fingerprint 计算“独立出处出现次数”读取投影，不建立首版 cluster 表。

ResearchRequest 同时展示业务状态和 `current_task_id` 对应的真实 Task 状态；成功导包后保留该 Task 引用，避免把已成功、失败或取消误显示成“Prompt 已就绪”。首次执行由 SQLite 发布协调器在同一短事务中完成 Task 入队和请求关联；通用手工重试也在同一事务把关联从失败 Task 切换到新 Task，并对幂等或并发结果复核精确 `taskType + canonical payload` 与聚合当前引用，避免 Worker 抢跑、页面继续观察旧任务或返回另一工作流的 Task。当请求已完成、全部候选均被拒绝且 Bundle 少于 5 版时，发布事务以 revision CAS 原子恢复为 `ready` 并关联新 Task；存在 accepted/needs_review 候选、版本已满或正在导包时拒绝重新执行。

## 6. 安全与失败

- Brief 不包含完整画像，仅包含用户填写的目标岗位等非身份字段。
- 外部 Agent 工作目录不是仓库或 data root，沙箱固定 read-only。
- 外部文本以 React 文本节点展示，链接验证后使用 `noopener noreferrer`。
- 失败任务不删除旧 Prompt/Schema；无效 Bundle 不改变当前候选。
- 自动来源首版统一 `unverified`，人工接受不把它提升为已核验。

## 7. 测试映射

| 测试层             | 覆盖                                                         |
| ------------------ | ------------------------------------------------------------ |
| Domain/Application | Brief/Bundle Schema、指纹、URL、去重、导入 CAS、审核和状态机 |
| DB 集成            | 迁移、Task 原子发布/重绑、取消门控、候选替换、accepted 保护  |
| Worker             | 伪执行器成功/失败/取消/超限、统一导入路径与并发键            |
| Web/浏览器         | 请求创建、导出、执行、手工导入、轮询、审核、网友列表和窄屏   |
