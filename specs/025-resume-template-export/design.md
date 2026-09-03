# 025 多模板简历制作与本地导出设计

> 状态：Implemented

## 边界

- `packages/resume-template` 保存公开投递 Schema、模板注册表和同源 React/HTML 渲染器，不访问数据库或浏览器。
- `packages/application` 编排草稿、头像、导出请求和任务，声明 Repository 端口。
- `packages/db` 实现草稿、导出请求和临时文件持久化。
- Web 只负责编辑、快照和交付；Worker 执行 `resume.export.pdf@v1` 并运行 Playwright。

## 数据模型

`resume_template_drafts` 以 `(profile_id, template_key, template_version)` 唯一，保存源画像版本、公开内容 JSON、头像文件和 revision。`resume_export_requests` 保存一次不可变导出快照对应的输入 HTML、输出文件、任务状态和过期时间。源画像版本 ID 仅用于陈旧检测，不建立外键，以免阻止画像历史修剪。

## 导出数据流

1. Web 在导出前完成草稿保存，并把同源渲染器生成的 HTML 写入临时 `export` 文件。
2. HTML 请求直接交付该文件；PDF 请求入队，只把导出请求 ID 放入任务 payload。
3. Worker 读取 HTML，等待字体就绪，以 A4/背景图形生成 PDF，登记输出文件并完成任务。
4. Web 轮询请求状态，完成后交付文件；交付后清理输入和输出。清理任务兜底删除超过 24 小时的中转文件。

## 交互

制作页画布中的投递字段使用受控 `contenteditable` 文本块，点击后直接原位编辑；iframe 只向外层传递字段路径和值，外层仍通过草稿 API、Zod 和 revision 完成持久化。左栏只保留章节索引，空的列表章节由顶部“添加一项”创建首个可编辑块。求职方向属于基本信息并紧邻模板姓名右侧，以灰蓝色粗体次标题显示，不生成独立 section。专业技能把换行分隔的完整事实句子渲染为一个可编辑无序列表。顶部对当前章节提供字号、字距和行高控制，控件组在桌面端与 A4 画布水平中心对齐；这些版本化排版值写入 `content_json.formatting` 并由同源渲染器消费。当前 section 的靛蓝轮廓和珊瑚色光标只存在于编辑模式。保存反馈为持久 `role=status`；冲突为 `role=alert` 并阻止导出。资料刷新使用应用自有确认对话框。

## 安全

- 所有 mutation 使用现有 CSRF 双提交校验。
- HTML 对用户内容进行转义，内置模板不得插入任意 HTML。
- HTML 编辑脚本不访问网络，仅切换 contenteditable、保存当前文档和打印。
- 头像同时验证声明 MIME、文件签名、非空和大小，不接受 SVG。

## 响应式与打印

桌面为顶部排版工具 + 紧凑章节索引 + A4 画布；窄屏的排版工具和章节索引横向滚动，画布按容器缩放。文字编辑始终发生在画布内。打印渲染固定 A4，模板自己控制页边距和 `break-inside`，后台控件与编辑标记从打印 DOM 中排除。
