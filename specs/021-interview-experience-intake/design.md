# 021 个人面经文档导入设计

> 状态：Implemented

## 1. 依赖与复用

```text
apps/web ──► packages/application ──► packages/domain
    │                 │                     ▲
    │                 ├──► @jobhunter/resume 文本提取
    │                 └──► ExperienceRepository / ArtifactStore 端口
    ▼                                       │
packages/db ────────────────────────────────┘
```

面经数据不写入 `resume_documents`。应用层只复用 `detectResumeMediaType`、`parseResumeText` 和 ArtifactStore；SQLite 使用独立 `experience_documents`、`interview_experiences`、`interview_question_entries` 表。

首版解析是确定性的 `personal-experience-parser@v1`，不注册 Agent 或 Worker Task。单文件 10 MiB 上限与现有简历上传一致，文件探测、文本提取和 Artifact 写入在事务外完成。后续增加 Agent 回退时保持同一草稿 Schema 和证据校验。

## 2. 标准模板

规范模板标识为 `personal-experience@v1`。`docs/templates/personal-interview-experience-v1.md` 是人可读本地资产；应用层导出的模板常量与该文件由测试保持字节一致。

模板采用“一文件可含多段经历”的结构：

```markdown
# 个人面试经历

## 经历 1

### 基本信息

- 公司：
- 岗位：
- 面试阶段：
- 面试日期：
- 结果：
- 难度：
- 标签：

### 问答

#### Q1

问题：
回答：
复盘：

### 过程与备注
```

在线填写只创建一段经历，由同一渲染器生成该 Markdown 后走统一导入路径，避免形成第二套结构语义。

## 3. 领域与状态

`ExperienceDocument` 状态：

```text
draft ──接受──► accepted
  └──拒绝──► rejected
```

解析或校对期间保持 `draft`。文档拥有一个或多个 `InterviewExperience`，每段经历拥有有序 `InterviewQuestionEntry`。问题条目保存问题、可选回答、可选复盘，以及相对于 `normalized_text` 的证据范围；在线填写生成的 Markdown 同样提供文档范围。`extracted_text` 保持解析器原始输出，换行和空白清洗导致的偏移变化只体现在 `normalized_text`。

草稿保存使用 `expectedRevision` CAS。接受要求当前修订匹配且至少存在一个非空问题。接受后首版只读；修改通过后续显式修订规格完成，不静默改写历史。

## 4. 清洗与解析

流程分四层：

1. 媒体探测与 UTF-8/PDF/DOCX 文本提取。
2. 文本清洗：移除 NUL/BOM、统一 CRLF、Unicode NFKC、清理行尾空白和连续空行。
3. 结构识别：优先标准模板标题，其次识别 `Q1/A1`、`问题/回答`、`问/答`；不能归类的非空段落进入备注。
4. 值规范化：去除 Q/A 标记和外层空白；元数据只采用显式字段；空回答保存为 `null`。

解析输出包含 `warnings`，例如缺少公司、缺少岗位、没有问题、未回答问题和存在未归类备注。警告不提升为事实，也不丢弃内容。

## 5. 数据表

迁移 `0018_interview_experience_intake.sql` 新增：

| 表                           | 关键约束                                                               |
| ---------------------------- | ---------------------------------------------------------------------- |
| `experience_documents`       | Artifact、内容哈希、解析器/模板版本、提取文本、状态、警告、修订号      |
| `interview_experiences`      | document 内序号唯一；个人来源；草稿/已接受状态；显式元数据和备注       |
| `interview_question_entries` | experience 内序号唯一；问题非空；可选回答/复盘；证据范围成对为空或合法 |

删除文档级联经历和问题。Artifact 可能与简历等业务对象按内容去重，因此删除只隔离无其他业务引用的文件。

## 6. 应用用例

`InterviewExperienceRepository` 提供文档/经历/问题的事务性创建、读取、CAS 替换、接受和删除影响操作。

`InterviewExperienceService` 提供：

- `template()`：返回版本、文件名和 Markdown。
- `importFile()`：探测、存 Artifact、提取、规范化并创建草稿。
- `createOnline()`：渲染标准 Markdown 后调用统一导入内部路径。
- `list()` / `get()`：历史列表和草稿详情。
- `replaceDraft()`：CAS 替换规范化草稿。
- `accept()`：CAS 接受文档及经历。
- `previewDeletion()` / `delete()`：稳定影响哈希和 Artifact 隔离。

## 7. Web 契约

- `GET /api/interview/experiences/template`
- `POST /api/interview/experiences/imports`（multipart）
- `POST /api/interview/experiences/online`（JSON）
- `GET /api/interview/experiences/:id`
- `PUT /api/interview/experiences/:id/draft`
- `POST /api/interview/experiences/:id/accept`
- `GET/DELETE /api/interview/experiences/:id/deletion`

页面：

- `/interview/experiences`：模板预览/下载、单文件上传、在线填写和历史列表。
- `/interview/experiences/:id`：证据摘要、结构警告、元数据/问答/备注校对、接受和删除。

上传和在线填写成功后前往草稿页。保存留在草稿页并显示持久内联状态；接受后仍停留在详情页并切为只读历史记录。所有表单 `noValidate`，Textarea 禁止自由 resize，失败保留用户输入。

## 8. 测试映射

| 测试层          | 覆盖                                                                  |
| --------------- | --------------------------------------------------------------------- |
| Domain 单元测试 | 清洗、模板/常见 Q/A 解析、空答案、证据范围、警告和接受不变量          |
| Application     | 文件/在线统一链路、幂等、CAS、接受和模板资产一致性                    |
| DB 集成测试     | 0018 迁移、唯一约束、级联、CAS、共享 Artifact 删除保护                |
| Web/浏览器      | 模板下载、上传、在线填写、校对、接受、历史列表、失败恢复和 390px 布局 |

测试使用脱敏文本和内存字节，不访问网络或模型。
