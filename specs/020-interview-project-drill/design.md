# 020 简历项目浅档拷打设计

> 状态：Implemented

## 1. 依赖边界

```text
apps/web ──► packages/application ──► packages/domain
    │                 │                     ▲
    │                 ├──► agent-core       │
    │                 └──► Repository ports │
    ▼                                       │
packages/db ────────────────────────────────┘

apps/worker ──► application handlers ──► AgentRunner / ArtifactStore / repositories
```

本增量不新增通用编排包。稳定的会话状态、不变量和覆盖枚举进入 `packages/domain/interview`；用例、仓储端口、任务 Schema、Agent 定义和 Markdown 渲染进入 `packages/application/interview`。`packages/db` 实现 SQLite 仓储；Web 和 Worker 只做装配。

内部问题 Agent 与回答摘要 Agent 均使用现有 `AgentRunner`，工具列表为空。它们是面试准备边界的版本化定义，不获得数据库、Artifact、网络、文件或项目目录访问权。

## 2. 核心状态

### 2.1 档案与来源快照

`ResumeProjectSnapshot` 保存 `profileId`、`profileVersionId`、原项目下标、规范化项目 JSON、内容哈希和创建时间。`ProjectDossier` 只引用该快照，并保存来源连接状态与最新 Markdown Artifact 引用。

创建用例先加载指定画像版本，按下标重新计算项目哈希并与请求值比较，再在同一 SQLite 事务中 upsert 快照和档案。`profileVersionId + projectIndex + projectHash` 唯一，重复创建返回已有档案。

### 2.2 会话和轮次

会话状态只有：

- `active`：允许对最新轮次执行合法操作；
- `paused`：只读，继续后回到 active；
- `completed`：默认只读，可由用户显式继续并恢复为 active。

同一档案最多只有一个 `active` 会话，可以保留多个 `paused` 会话。恢复任意 `paused` 或 `completed` 会话时，仓储在同一事务中先将另一个 `active` 会话暂停，再激活目标会话；若另一个会话仍有问题或摘要任务待处理，应用层拒绝切换，避免迟到结果写入错误上下文。

轮次状态为：

```text
question_pending ──同步生成成功──► awaiting_answer ──提交回答──► digest_pending
       │                                  │                         │
       └──取消──► cancelled               └──跳过──► skipped        └──Worker成功──► ready
```

失败任务不隐式改变业务状态，轮次保留其 pending 状态和任务引用以支持现有任务重试。显式取消由应用用例先取消 Task，再把尚未提交结果的轮次标记为 `cancelled`。Handler 提交前使用 `contextRevision + contextHash + turnStatus + taskId` 比较并交换，迟到结果被丢弃为可诊断冲突。

首次提问和后续提问都先在短事务中创建无 Task 引用的 `question_pending` 占位轮次，再由 Web 在事务外同步调用问题 Agent。模型输出通过后置校验后使用会话修订和上下文哈希 CAS 提交；请求失败或取消则删除尚无可见内容的占位轮次。浏览器取消后立即重试时，新请求可替换仍未清理的无 Task 占位，旧请求的迟到结果由 CAS 拒绝。历史版本遗留的 `interview.project-question` Task 仍可由兼容 Handler 恢复，但新请求不再发布该任务。

回答先以事务追加 `DrillAnswerRevision`、把轮次置为 `digest_pending` 并增加会话 `contextRevision`，然后入队 `interview.project-answer-digest`。同一 idempotency token 不重复追加修订。失败摘要可通过任务重试继续。

## 3. Profile 与上下文

内置 `resume-only@v1` 定义包含：

- 允许证据：`resume_project`、`user_answer`、`derived_claim`；
- 固定覆盖维度及提问策略；
- 空工具集；
- 问题/摘要 Agent 版本和 Prompt 版本；
- 禁止行为和后置校验规则。

会话保存 `profileKey`、`profileVersion`、规范定义 JSON 的 SHA-256 和能力摘要。应用层按题序构造最小上下文：项目快照、已完成轮次的问题和最新回答、当前有效知识项、冲突、覆盖状态。问题生成器在调用模型前后都重算上下文哈希。

首版问题输出 Schema：

```ts
{
  question: string;
  intent: string;
  primaryDimension: CoverageDimension;
  guidanceSlots: string[];
  evidenceRefs: Array<{ kind: EvidenceKind; id: string }>;
}
```

后置校验采用确定性规则加证据集合校验：限制长度、拒绝第一人称作答模式、拒绝答案型段落、拒绝源码/目录/Git/Shell 操作要求，并确保每个引用都在输入允许集合内。失败返回安全的同步接口错误，删除问题占位且不保存问题正文。

摘要输出包含知识项、歧义、冲突和覆盖更新。每个知识项保存回答字符偏移；应用层用 JS 字符串边界验证 `0 <= start < end <= answer.length`，并验证切片与输出证据文本一致。新修订提交成功后，在同一事务将旧修订派生项标记为 `superseded`。

## 4. 数据表

新增迁移 `0017_interview_project_drill.sql`：

| 表                         | 关键约束                                                                |
| -------------------------- | ----------------------------------------------------------------------- |
| `resume_project_snapshots` | 来源画像版本、项目下标和内容哈希唯一；快照 JSON 不更新                  |
| `project_dossiers`         | 一个快照最多一个档案；保存来源状态、投影 Artifact、修订号               |
| `drill_sessions`           | 冻结 Profile 定义；状态 CHECK；最多一个 active；`context_revision >= 0` |
| `drill_turns`              | 会话内题序唯一；状态 CHECK；保存任务和 AgentRun 引用                    |
| `drill_answer_revisions`   | 轮次内修订号与 idempotency key 唯一；正文和哈希不可变                   |
| `project_knowledge_items`  | 类型、来源回答修订、偏移、状态和模型版本；状态 CHECK                    |
| `drill_coverage`           | `session_id + dimension` 主键；状态 CHECK                               |

Markdown 投影复用 ArtifactStore 的 `export` 类型，并由 `project_dossiers` 的专用外键区分用途，避免为语义子类型重建已有 SQLite CHECK 表。Artifact 可因相同内容跨档案去重，因此档案删除只在无其他业务引用且通过现有隔离/清理协议时清理物理文件。

外键删除策略：删除档案级联会话、轮次、回答、知识项和覆盖；画像版本删除不级联快照，使用删除服务先将来源标为 `detached`。AgentRun 使用 restrict 或显式解除引用，不由档案删除直接清除。

## 5. 应用用例与端口

`InterviewProjectRepository` 提供档案、会话、轮次、回答、知识项、覆盖和投影引用的事务性操作；读取方法返回已经过运行时 Schema 校验的记录。首版应用服务分为：

- `ProjectDossierService`：创建、列表、详情、删除预览和确认；
- `DrillSessionService`：创建、暂停、继续、完成、请求问题、提交/修订回答、跳过、取消；
- `ProjectQuestionGenerator`：在 Web 请求内构造上下文、调用 Agent、校验并提交问题；遗留 Handler 复用该生成器；
- `ProjectAnswerDigestHandler`：调用 Agent、校验偏移、提交推导和覆盖；
- `ProjectNotebookHandler`：读取权威状态、确定性渲染、写 Artifact、更新最新引用。

问题由 Web 同步生成，成功后只为 Markdown 投影入队；摘要成功后同样入队投影任务。投影任务使用 `dossierId + sourceRevision` 幂等键和 `interview-dossier:<id>:revision:<revision>` 并发键，不同 revision 都会形成可恢复任务，生产 Worker 对该类型固定单消费者串行执行。旧 revision 通过比较并交换失效，不能吞掉最新投影。最终事务同时核验 Task ID、类型、payload、`running`、有效租约与未取消条件；文件写入期间取消时先注销新 Artifact 再退出，提交已成功后才到达的取消则视为过晚。若 Artifact 已写入但最终 CAS 或 Task 门控失败，Repository 在同一短事务注销未被任何 dossier 引用的逻辑文件、mapping 与非共享 entity，使物理文件进入通用 orphan cleanup。模型调用和文件写入发生在事务外，最终提交使用比较并交换。

## 6. Web 契约与页面

Web API 使用严格 Schema 和既有 CSRF/错误信封：

- `GET/POST /api/interview/projects`
- `GET/DELETE /api/interview/projects/:dossierId`
- `POST /api/interview/projects/:dossierId/sessions`
- `POST /api/interview/sessions/:sessionId/questions`
- `POST /api/interview/turns/:turnId/answers`
- `POST /api/interview/turns/:turnId/skip`
- `POST /api/interview/sessions/:sessionId/state`
- `GET /api/interview/projects/:dossierId/notebook`

`/interview` 将画像项目队列和档案恢复栏组织为同一准备工作台：宽屏主次双栏、窄屏自然单栏，项目和档案均使用连续档案行；`/interview/projects/:id` 在项目快照下方提供全部拷打会话的常驻索引，按 `updatedAt` 降序排列并以“会话 - YYYY-MM-DD HH:mm:ss”命名。默认选择 active 会话，否则选择最近修改的会话。切换索引只选择服务端详情中已有的会话视图；已完成会话显示完整问答和覆盖记录，并可显式恢复后继续修改。问题接口使用 `text/event-stream` 依次发送 `stage`、`complete` 或 `error` 事件；阶段只表达服务端已进入的准备上下文、生成、校验、保存步骤，不包含问题正文或虚假百分比。页面保持稳定等待状态并支持取消，收到完整且已校验的问题后刷新权威详情；回答摘要和投影仍轮询既有 Task API。浏览器不另存整份回答历史。

## 7. 删除与隐私

删除预览返回计数、最新档案修订号和基于影响集合计算的确认哈希。确认操作重新计算影响集合和确认哈希；不一致返回冲突。数据库删除与 Artifact 隔离分阶段执行，文件清除失败进入可恢复状态。

任务 payload 只包含 UUID、题序、上下文哈希、修订号和幂等 token 哈希，不包含项目或回答正文。AgentRun 保留结构化输入哈希和输出；当前 AgentRunStore 会保存模型输出 JSON，因此其读取入口按本地敏感信息处理，诊断页只展示摘要而不展示正文。

## 8. 失败、取消与恢复

- 模型缺失、限流和临时错误由同步问题接口映射为安全错误，用户可直接重试；回答摘要仍沿用 Task 错误分类与退避。
- 无效问题输出不会展示；同步请求删除未提交的占位回合后允许重新生成。
- 待处理任务取消后，业务轮次变为 `cancelled`；运行中任务使用协作取消，迟到提交由比较并交换拒绝。
- Worker 重启后摘要与投影任务按既有租约恢复；遗留问题 Task 仍由兼容 Handler 处理。
- 投影失败不修改 `latestNotebookArtifactId`，上一个成功版本继续可下载。

## 9. 测试映射

| 测试层               | 覆盖                                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------------------- |
| Domain 单元测试      | 状态转换、题序、覆盖枚举、回答偏移、后置安全校验（DRILL-003,006,009,010,011）                              |
| Application 单元测试 | 幂等创建、最小上下文、任务 payload、并发/迟到结果、修订与投影触发（DRILL-001–013）                         |
| DB 集成测试          | 迁移、唯一约束、级联/限制、CAS、删除影响和 Artifact 引用（DRILL-001,002,007,009,013,015）                  |
| Agent 合约测试       | 有效输出、代答、越权要求、无效引用和偏移（DRILL-004,006,008, DRILL-Q04）                                   |
| Worker 集成测试      | 摘要与投影的成功、重试、失败、取消、重启恢复和失败隔离（DRILL-008,013, DRILL-Q01,Q03,Q05）                 |
| Web Route/浏览器测试 | 创建、空态、逐题交互、修订、跳过、暂停/完成、失败诊断、下载和删除确认（DRILL-001,003,005,007,010,014,015） |

所有测试使用脱敏固定画像和伪模型；普通 CI 不访问网络或真实模型。
