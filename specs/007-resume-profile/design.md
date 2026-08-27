# 007 简历导入与候选人画像设计

> 状态：Implemented

## 组件

- `packages/resume/import`：媒体探测、大小限制和 Artifact 写入。
- `packages/resume/parsers`：PDF 使用 `pdfjs-dist`，DOCX 使用 `mammoth`，TXT 严格 UTF-8。
- `packages/resume/profile-schema`：画像与 evidence Schema。
- `packages/resume/resume-polish-agent`：按目标岗位改写选中经历描述的 Agent 定义、输入输出 Schema 与事实保持校验。
- `packages/application/profile`：导入、提取、修正、锁定、版本切换和删除预览。

导入和文本解析可在 CLI 同步执行小文件，但 Agent 提取始终提交 Worker 任务。内容哈希作为导入和任务幂等键的一部分。

AI 润色同样只由 Worker 执行。Web 用例只提交 `profileId`、来源版本、选中章节和建议 ID；Worker 从来源版本读取目标岗位及所选章节，在事务外调用模型，再把经过 Schema 和条目数量校验的建议写入专用建议仓储。Web 轮询专用润色状态接口，任务与 Agent 通用诊断接口仍只暴露运行元数据。

## 画像结构

事实字段以数组保存并包含 `value`、`confidence`、`evidenceRefs`；证据引用提取文本的字符范围及不可逆短摘要，不复制大段正文到日志。偏好放在 `preferences`，来源标记 user，不由 Agent 生成。

## 合并与事务

Agent 成功后应用层读取当前版本，在事务外计算合并，再在短事务内将旧 current 置 0、插入新版本。并发修改通过预期 current version ID 检测冲突。

润色建议不属于画像版本，也不自动参与合并。建议保存 `profileId`、来源 `ProfileVersionId`、所选章节、对应描述数组和 AgentRun 引用；页面只有在来源版本仍是当前编辑基线时才允许把建议应用到客户端草稿。采用建议只替换对应条目的 `highlights`，随后复用完整在线简历的“保存简历”操作创建人工修正版。项目名称、公司、职位、角色、日期、证据和未选章节均沿用原草稿。

润色 Agent 输入使用当前目标岗位大类，并仅携带选中章节的必要字段。输出以与输入等长的描述数组表示；应用层拒绝未选章节返回内容、数组长度变化、空描述和越界结果。提示词明确禁止新增事实、技术、指标和职责，只允许在不改变事实含义的前提下压缩冗余、强化动作与结果表达，并对齐目标岗位用语。

删除先执行 dry-run，返回受影响 ID 与数量；真正删除由 Operations 的确认机制调用，文件清理与数据库清理使用可恢复任务步骤和审计日志。

### 敏感数据删除协议

删除以 `resumeDocumentId` 为入口，并扩展为完整影响闭包：引用该简历的画像、这些画像的全部版本与简历、确定性匹配结果、建议，以及只被该闭包引用的 AgentRun。若同一画像 AgentRun 被其他画像复用，则其他画像也进入影响闭包，避免删除后仍残留同一份结构化简历事实。

应用层先生成稳定排序的 `ResumeDeletionImpact` 和 SHA-256 `impactHash`。确认请求必须携带预览得到的 hash；执行前重新计算，影响集合变化时拒绝删除并要求重新预览。

文件与数据库采用可恢复的分阶段协议：

1. 将受影响 Artifact 文件原子移动到 data root 内的隔离目录，并保留恢复句柄。
2. 在一个 SQLite 短事务中删除匹配/画像/简历等敏感关系，将 Artifact 标记 `deleted_at` 并把路径切换为隔离路径；事务失败时恢复文件。
3. 事务提交后幂等清理隔离文件，再删除无引用的 Artifact 墓碑；清理失败时保留墓碑供维护任务重试，已删除内容不会重新出现在普通查询中。

删除任务只接受由显式确认生成的 `resume.delete.confirmed` payload；普通导入、查询和画像任务不得调用该能力。任务日志只记录 impactHash 和数量，不记录简历正文、原文件名或联系方式。

## 测试

提交脱敏的最小 PDF/DOCX/TXT fixtures、空文本和损坏文件。Fake Agent 测试版本、锁定、章节选择、输出等长校验与建议持久化；Web E2E 覆盖提交、轮询、失败、应用到草稿和最终保存。真实模型只进入离线评测，不进入普通 CI。
