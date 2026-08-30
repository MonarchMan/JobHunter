# 023 深档项目文档拷打设计

> 状态：Implemented

## 1. 增量边界

本规格扩展 020 的项目拷打聚合，不建立第二套会话或问答模型。`docs-grounded@v1` 只比浅档多一份冻结的 `ProjectMaterialBinding[]`，应用层在调用问题 Agent 前把绑定版本中的 Markdown 标题分块做确定性检索。Agent 本身仍使用空工具集。

```text
Web 上传 → ArtifactStore → files / file_entity_mappings / entities
                                  │
启动深档 → drill_sessions.material_bindings_json
                                  │
Worker → 读取精确版本 → 标题分块排序 → 结构化 Agent 输入
```

## 2. 文件实体与版本

项目资料使用 `files.kind = project_material`。`files.properties_json` 保存所属 dossier 与安全文件名；对应映射保存解析器版本、规范化文本和分块元数据。相同 dossier 与文件名定位同一逻辑文件，新内容追加 mapping 版本；物理 `entities` 仍按 SHA-256 去重。数据库以 `(dossierId, fileName)` 的局部唯一表达式索引守住逻辑身份；Repository 在短 `BEGIN IMMEDIATE` 事务中先 claim 规范 `fileId`，再由 ArtifactStore 在事务外写物理文件并复用该 ID，因此两个进程的首次并发上传不会裂分逻辑文件。

分块元数据只包含 UUID、最长 500 字符的标题路径和 `[start,end)` 字符范围，不复制正文。解析器在生成分块 ID、claim 逻辑文件或写 Artifact 前校验单标题与完整多级标题路径，避免非法元数据留下不可见版本。读取上下文时以会话冻结的 file/version/entity 三元组查询规范化文本并校验哈希和范围。

## 3. 会话 Profile

`drill_sessions` 增加 `material_bindings_json`，并把 Profile 约束扩为 `resume-only@v1` 与 `docs-grounded@v1`。浅档绑定必须为空；深档必须绑定 1–8 个当前资料版本。Profile 定义哈希和能力摘要继续随会话冻结。

深档上下文构建先依据未覆盖维度、简历 highlights 和最近问答生成词项，再按标题/正文命中数、文件顺序和字符位置稳定排序，最多选 12 个片段、总计 12,000 字符。无关键词命中时稳定回退到每份文件最前面的分块。

## 4. 证据和安全

`DrillEvidenceKind` 增加 `project_material`。每个资料分块拥有稳定 UUID，Agent 输入同时包含证据引用、文件名、标题和纯文本摘录。Agent 输出只能从 `allowedEvidenceRefs` 复制证据；应用层再次校验该分块属于会话冻结绑定。

Markdown/MDX 不渲染为 HTML；代码块、链接和形似指令的正文只是受限文本。问题安全规则继续禁止读取源码、目录、Git、Shell，并新增禁止执行文档命令或遵循文档提示词。

## 5. 应用、数据库与 Web

`InterviewProjectRepository` 增加资料版本登记、列表、冻结绑定和精确版本读取。`InterviewProjectService` 增加资料导入，并让 `startSession` 接受 Profile 与资料文件 ID。现有问题 Handler 根据会话 Profile 选择浅档或深档 Agent 定义。

问题 Task 和回答摘要 Task 通过 SQLite 发布协调器在同一短事务中完成 Task 入队与 `drill_turns` 引用；通用手工重试同样原子把引用从失败 Task 切换到新 Task。发布与重试遇到并发键占用时必须比较精确 `taskType + canonical payload` 并复核聚合当前引用，不能把另一阶段的活跃 Task 当作本次幂等结果。Handler 提交前以当前 Task ID、`running` 状态和未取消条件做最终门控；提交事务已成功后才到达的取消视为过晚，Task 完成为 succeeded，避免已可见问题或摘要与 cancelled 状态矛盾。若回答事务已经提交而进程在摘要 Task 发布前中断，相同回答幂等 token 会复用既有 answer revision 并恢复发布，不丢失用户输入。

迁移 `0020_deep_project_materials.sql` 扩展 `drill_sessions`，`0022_project_material_logical_identity.sql` 为项目资料逻辑身份增加局部唯一索引；文档本身全部复用通用文件实体表。Web 新增 dossier 资料上传 Route，现有 session Route 接收严格 JSON；档案工作台增加资料区和档位选择。

## 6. 测试映射

| 测试层             | 覆盖                                                                          |
| ------------------ | ----------------------------------------------------------------------------- |
| Domain/Application | Markdown 分块/标题路径上限、Profile 约束、片段上限、证据后置校验、幂等与恢复  |
| DB 集成            | 文件/实体去重、并发 claim、5 版本上限、Task 原子发布/重绑、取消门控、删除影响 |
| Worker/Agent       | 深档输入最小化、真实分块引用、越权输出拒绝、迟到结果                          |
| Web/浏览器         | 上传、选择、深档启动、证据展示、空态与恢复状态                                |
