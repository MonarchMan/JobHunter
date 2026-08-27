# 015 简历图片 OCR 设计

> 状态：Implemented

## 数据流

```text
Web multipart JPEG/PNG
        │ 内容签名、大小校验
        ▼
Artifact + ResumeDocument(needs_ocr)
        │
        └──► resume.profile.extract ──► 本地 Tesseract OCR
                                             │
                                             ▼
                              ResumeDocument(parsed + text)
                                             │
                                             ▼
                              现有 Resume Profile Agent
                                             │
                                             ▼
                                  current ProfileVersion
```

Web 组合根仍只保存文件、创建画像和入队任务。OCR 引擎只在 Worker 组合根装配；`resume.profile.extract` Handler 根据文档状态选择直接读取已解析文本，或先读取 Artifact 并执行 OCR。这样文本简历和图片简历共享任务类型、并发键、模型错误映射、画像证据校验与版本写入。

## 媒体与 OCR 边界

`@jobhunter/resume` 的媒体探测器增加 JPEG SOI/EOI 与 PNG 固定签名，输出规范媒体类型 `image/jpeg`、`image/png`。图片的确定性解析结果为 `needs_ocr`，不会把二进制误判为 UTF-8 文本。

OCR 通过 `ResumeOcrEngine` 端口调用。Tesseract 实现使用 `chi_sim` 与 `eng` 的本地 npm 语言数据路径，关闭远端语言数据下载；每次任务在 `finally` 中终止 OCR worker。引擎只返回归一化文字与稳定引擎版本，不持久化图片副本或中间图。

## Artifact 与文档更新

应用层声明只读 `ResumeArtifactReader` 端口；SQLite 实现按 Artifact ID 查询受控相对路径，经 data root 边界解析后读取且再次执行大小限制。`ResumeDocumentRepository.completeOcr` 只允许将 `needs_ocr` 文档更新为 `parsed`，保存 OCR 正文、引擎版本并清除旧错误；相同成功结果可幂等读取。

OCR、模型调用和画像写入分别发生在短 SQLite 语句之外。任务 payload 继续只包含 profile ID、resume document ID 和期望画像版本 ID。

## 质量门禁与错误

OCR 文字复用解析器的空白归一化规则，至少包含 80 个非空白字符且不超过 250,000 字符。过短文本映射为 `validation_failed`；OCR 引擎初始化、识别失败映射为 `io_temporary` 并允许任务重试；取消保持 `cancelled`。错误摘要只使用稳定描述。

当前只对 JPEG/PNG 执行 OCR。图片型 PDF 仍保存为 `needs_ocr`，Handler 返回明确的 `validation_failed`，不伪装为已支持。

## 页面交互

复用现有 `ResumeImport` 上传区，允许 `.jpg,.jpeg,.png`，并将文件类型与后台行为写在选择器邻近说明中。上传期间保持按钮尺寸、禁止重复提交；成功时显示任务 ID 和“后台 OCR/提取”状态，并限时轮询任务，完成后刷新 Server Component 以填充在线简历；失败时显示可恢复说明，轮询不可用或超时时保留手动刷新路径。移除不可用的“规划中”按钮，避免同一操作出现两个入口。

## 测试

- Resume 单元测试：JPEG/PNG 内容探测、图片 `needs_ocr`、取消与 OCR 质量门禁。
- DB/应用集成测试：图片 Artifact 导入、OCR 文档状态转换、画像 Agent 复用、去重和失败不写画像。
- Web 测试：multipart 图片接收、任务立即返回、上传控件类型与持久反馈。
- 参考样例验证：本地 OCR 输出包含“陕西师范大学”“python”“Prism”等稳定锚点。
- 回归：格式、lint、边界、类型、测试、构建、文档检查与 Premium 严格审计。
