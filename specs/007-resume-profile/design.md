# 007 简历导入与候选人画像设计

> 状态：Implemented

## 组件

- `packages/resume/import`：媒体探测、大小限制和 Artifact 写入。
- `packages/resume/parsers`：PDF 使用 `pdfjs-dist`，DOCX 使用 `mammoth`，TXT 严格 UTF-8。
- `packages/resume/profile-schema`：画像与 evidence Schema。
- `packages/application/profile`：导入、提取、修正、锁定、版本切换和删除预览。

导入和文本解析可在 CLI 同步执行小文件，但 Agent 提取始终提交 Worker 任务。内容哈希作为导入和任务幂等键的一部分。

## 画像结构

事实字段以数组保存并包含 `value`、`confidence`、`evidenceRefs`；证据引用提取文本的字符范围及不可逆短摘要，不复制大段正文到日志。偏好放在 `preferences`，来源标记 user，不由 Agent 生成。

## 合并与事务

Agent 成功后应用层读取当前版本，在事务外计算合并，再在短事务内将旧 current 置 0、插入新版本。并发修改通过预期 current version ID 检测冲突。

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

提交脱敏的最小 PDF/DOCX/TXT fixtures、空文本和损坏文件。Fake Agent 测试版本与锁定；真实模型只进入离线评测，不进入普通 CI。
