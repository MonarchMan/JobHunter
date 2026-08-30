# 013 简历驱动的异步职位摄取设计

> 状态：Implemented

## 组合与数据流

```text
Web multipart / CLI init
        │
        ▼
ResumeProfileWorkflow ── Artifact + ResumeDocument ──► resume.profile.extract
        │                                                   │
        │                                                   ▼
        │                                      current ProfileVersion
        │                                                   │
        └──────────────────────────────────────────► current profile for later manual scoring

初始化 ──► source.sync(sourceId) × enabled sources ──► JobSyncService
                                      │
                                      └──────────────► no matching task

职位详情“为此职位评分” ──► match.compute-revision(jobRevisionId, profileVersionId)
```

Web 只调用应用端口并返回任务 DTO；CLI 初始化在数据库 seed 成功后使用同一 `TaskService`/`ScheduleService` 入队。Worker 装配真实解析、同步、匹配和清理 Handler。

## Web 简历导入

`ResumeProfileWorkflow` 增加字节输入入口，与现有路径入口共用 `ResumeImportService`。Route Handler 接收 multipart `file`，限制 10 MiB，随后由内容探测器确认 PDF/DOCX/TXT；文件名只用于 UI，不参与类型判断。基线中解析结果为 `parsed` 时入队画像提取，`needs_ocr/failed` 只保存文档状态并返回可读错误；`015-resume-ocr` 在不改变 Web 异步边界的前提下扩展 JPEG/PNG 和 Worker OCR。

Web 组合根装配 ArtifactStore、ResumeDocumentRepository、CandidateProfileService 和 TaskService，但注册的 Handler 使用 unavailable stub，因此 Web 永不执行模型任务。

## 初始化与调度

CLI `init` 在幂等 seed 后：

1. 若参考图片 `docs/resumes/nowcoder_1787802316450.jpeg` 存在则优先调用同一导入工作流，否则兼容旧的 `agent简历 - 新.docx`；固定内容哈希使重复执行返回同一文档/任务。
2. 若已有画像已确认目标岗位，为所有启用来源入队固定幂等键的 `source.sync` 任务。
3. 同一前提下，为每个来源 upsert `source.sync:<sourceId>` 每日 `03:00 Asia/Shanghai` 计划；否则等待用户在来源页确认后显式创建或启用。
4. Web、CLI 和 Worker 组合根在来源目录与当前招聘渠道投影完成后执行同一计划对账服务：为目录内每个物理来源 upsert 固定 schedule key，且仅对“目标岗位已确认 + 当前渠道 + 三层开关有效”的来源启用。这样目录后续增加公司时无需重新初始化数据目录。
5. upsert `maintenance.cleanup:weekly` 每周日 `04:00 Asia/Shanghai` 计划。

计划只存任务 payload 和下一次执行时间；官网请求和清理均由 Worker 执行。Web 手动调度仍可覆盖来源计划。

## 候选职位预筛选

同步阶段直接使用 `ProfileJobIntakePolicy` 将目标岗位映射为内部大职位类别；不符合当前画像意向的职位不会写入 raw、Job 或 Revision。这样不会先保存全量职位再依赖匹配阶段筛选。

`ProfileJobIntakePolicy` 同时作为同步前置门禁：只有 `targetRoles` 至少映射出一个非“其他”的规范大类时才允许创建或启用来源同步。个人资料用原生单选框展示除“其他”外的规范职位大类，并继续以单元素 `targetRoles` 数组保存，避免自由文本与 taxonomy 漂移；旧值载入编辑器时归一化为对应大类。Web 来源页在门禁未满足时禁用同步入口并链接到个人资料；应用服务拒绝绕过页面的同步请求；Worker 在访问招聘来源前再次检查，以覆盖门禁启用前已存在的计划任务。`domains` 只描述能力领域，不自动视为用户确认的求职意向。

`MatchingBatchService` 只接受一个 `jobRevisionId` 和一个 `profileVersionId`，由职位详情的显式操作创建任务。它不再分页读取职位或画像，也不执行全量匹配。确定性评分不访问网络或模型；模型能力仅保留给用户主动请求的单职位理解/建议扩展。

## 清理任务

新增 `maintenance.cleanup` Handler，payload 为既有 `CleanupPolicy` 的运行时 Schema。Handler 在 Worker 中先生成计划，再立即以短期 token 执行；复用 `CleanupService` 的候选变化校验、孤立文件安全窗口和路径边界。计划/执行不放在数据库事务中，清理失败由任务策略处理。

## 事务、安全与可观测性

- Artifact 写入和文档登记复用现有去重边界；模型/网络调用不进入 SQLite 事务。
- Web 上传只记录任务 ID、媒体类型和稳定文档标识，不记录正文或文件名。
- 关键词筛选不调用网络或模型；JobUnderstanding/JobAdvice 仍是独立可选任务。
- 所有新增任务使用 Zod payload/output Schema 和稳定 idempotency key。

## 测试设计

- Web Route/浏览器测试：multipart PDF/DOCX、CSRF、立即返回任务、个人资料空态/处理中态。
- Web Route/浏览器测试：未确认目标岗位时禁用同步、提供个人资料入口且 API 不创建任务。
- CLI 集成测试：初始化 seed、默认简历幂等、未确认时跳过来源任务/计划，以及已确认时允许手动同步。
- Matching 集成测试：目标岗位 OR 命中、排除词、空目标岗位兼容和分页。
- Worker/应用测试：画像完成后匹配回调、cleanup Handler 和任务重试。
