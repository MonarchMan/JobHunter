# 029 招聘邮件识别与申请进展跟踪任务

> 状态：Ready

- [x] **MAIL-T001** 建立 029 规格、设计和任务文档，更新总体架构与数据模型，并新增 ADR-0055 固定独立招聘进展领域、本地增量轮询、凭据边界及 `packages/mail/core`、`packages/mail/connectors` 目录决策。（MAIL-001, MAIL-002, MAIL-003, MAIL-004, MAIL-007, MAIL-010, MAIL-012, MAIL-017, MAIL-018, MAIL-Q01, MAIL-Q02, MAIL-Q04, MAIL-Q05）
- [x] **MAIL-T002** 建立两个嵌套 workspace 包及公开入口，更新 pnpm、TypeScript、dependency-cruiser 和构建配置，验证 `application → mail/core ← mail/connectors` 的单向依赖。（MAIL-Q01, MAIL-Q02）
- [x] **MAIL-T003** 在领域层实现招聘邮件分类结果、申请事件、申请状态、时间值对象和状态投影，并以纯单元测试覆盖规则分类、Offer 意向以及首版无人工更正边界。（MAIL-008, MAIL-009, MAIL-013, MAIL-014, MAIL-Q02, MAIL-Q08）
- [x] **MAIL-T004** 实现 `mail_message_refs`、`job_applications`、`application_events` 三张表的迁移、Drizzle Schema、Repository、来源邮件引用、申请事件幂等和删除影响查询。（MAIL-005, MAIL-007, MAIL-012, MAIL-013, MAIL-014, MAIL-018, MAIL-Q08, MAIL-Q09）
- [x] **MAIL-T005** 在 `mail/core` 定义授权、文件夹、增量发现、按需正文、健康检查、错误分类和连接器 Registry，并提供公共契约测试与假连接器。（MAIL-001, MAIL-004, MAIL-005, MAIL-006, MAIL-Q01, MAIL-Q03, MAIL-Q06）
- [ ] **MAIL-T006** 实现 Gmail 连接器和本机 OAuth/加密文件凭据适配，使用 `gmail.readonly`、有界 `messages.list` 和 `users.history.list`，覆盖同步期间追平、过期 `historyId` 重建、稳定 message ID、可选安全来源 URL、断开和重新授权；通过 Gmail 独立 supported 门禁。（MAIL-001, MAIL-002, MAIL-003, MAIL-004, MAIL-005, MAIL-018, MAIL-Q03, MAIL-Q06, MAIL-Q09）
- [ ] **MAIL-T007** 实现 Microsoft Graph 连接器，使用 delegated `Mail.Read`、文件夹级 message delta、`Prefer: IdType="ImmutableId"`、`changeKey` 和经校验的 `webLink`，覆盖 delta 失效重建、移动/删除变化、断开和重新授权；通过 Graph 独立 supported 门禁。（MAIL-001, MAIL-002, MAIL-003, MAIL-004, MAIL-005, MAIL-018, MAIL-Q03, MAIL-Q06, MAIL-Q09）
- [ ] **MAIL-T008** 实现通用 IMAP over TLS 连接器，覆盖 QQ、163 和企业邮箱应用专用密码配置、严格 TLS、`EXAMINE`、`UID FETCH`/`BODY.PEEK`、`UIDVALIDITY + UID`、CONDSTORE/QRESYNC 与 UID 扫描降级、文件夹重建和凭据撤销；通过 IMAP 独立 supported 门禁。（MAIL-001, MAIL-002, MAIL-003, MAIL-004, MAIL-005, MAIL-018, MAIL-Q03, MAIL-Q06, MAIL-Q09）
- [ ] **MAIL-T009** 实现本地邮箱配置、运行状态原子文件、文件夹选择、默认 30 天有界回溯、过期游标重建、同步计划和 `mailbox.sync@v1` Handler；分别保存 Gmail history、Graph 文件夹 delta 和 IMAP 文件夹 UID 状态，增量页先原子保存引用并发布分类任务，提交成功后再推进文件游标，崩溃窗口通过安全重放收敛。（MAIL-001, MAIL-002, MAIL-003, MAIL-004, MAIL-005, MAIL-017, MAIL-Q06, MAIL-Q08, MAIL-Q09）
- [x] **MAIL-T010** 实现有界 MIME/HTML 正文清洗、远程资源阻断、全部附件忽略、引用历史分离和高召回候选粗筛，确保无关邮件正文不落库且附件不发送给模型。（MAIL-006, MAIL-007, MAIL-008, MAIL-016, MAIL-Q03, MAIL-Q04, MAIL-Q05, MAIL-Q07）
- [x] **MAIL-T011** 实现版本化确定性招聘候选筛选，覆盖中英文申请确认、笔试、面试、改期、取消、拒绝、流程结束、Offer，以及宣讲营销、岗位推广、问卷、验证码和普通招聘资讯等稳定负例；未知模板保守放行。（MAIL-008, MAIL-010, MAIL-011, MAIL-Q03, MAIL-Q07）
- [x] **MAIL-T012** 实现无工具 `recruitment-mail.classify@v1` Agent、模型显式开关、业务输出校验、禁用持久化输出缓存、脱敏运行记录和评测；模型关闭或失败时把模糊候选降级到待确认，AgentRun 不保存字段提取结果。（MAIL-009, MAIL-010, MAIL-011, MAIL-Q03, MAIL-Q04, MAIL-Q05, MAIL-Q07）
- [ ] **MAIL-T013** 实现 `mail.classify@v1` Handler、待确认状态、详情打开时重新读取分类、确认/忽略、申请关联、不可变事件提交和当前状态投影，覆盖同公司多岗位、原邮件不可用、重复任务和乱序邮件。（MAIL-011, MAIL-012, MAIL-013, MAIL-014, MAIL-017, MAIL-Q08）
- [ ] **MAIL-T014** 实现 Web 邮箱设置、同步状态、待确认列表、确认/忽略、申请选择、申请列表、时间线、截止时间与外链安全交互，覆盖时区推断和首版无字段更正边界。（MAIL-001, MAIL-009, MAIL-011, MAIL-012, MAIL-014, MAIL-015, MAIL-016）
- [x] **MAIL-T014A** 增加 Web 邮箱配置最小闭环：从设置页管理 IMAP/QQ 连接，非敏感配置按原子 JSON 文件保存，凭据交由独立凭据端口保存；邮箱配置文件路径支持 `JOBHUNTER_MAILBOX_CONFIG_PATH` 覆盖。（MAIL-001, MAIL-002, MAIL-015, MAIL-Q03, MAIL-Q04, MAIL-Q09）
- [x] **MAIL-T014B** 将 Gmail、Microsoft 365 / Outlook 和 IMAP 统一接入设置页的渐进式添加入口：右上角“+”先选择 provider，再显示对应添加卡片；OAuth 使用 state、PKCE、HttpOnly Cookie 和凭据端口，未配置客户端时明确禁用。（MAIL-001, MAIL-002, MAIL-015, MAIL-015A, MAIL-Q03, MAIL-Q04）
- [x] **MAIL-T014C** 调整设置页凭据回显边界：普通快照继续脱敏，用户主动点击时经无缓存接口读取 IMAP 授权码，默认密码模式并在隐藏时清理前端明文；OAuth 令牌禁止回传，同时修复窄屏编辑表单布局，并通过只预热 Win32 API 的空闲超时辅助进程消除重复 PowerShell 启动延迟。（MAIL-002, MAIL-015, MAIL-Q04）
- [x] **MAIL-T014D** 按 ADR-0056 将邮箱凭据迁移为跨平台 AES-256-GCM 加密文件，支持独立密钥文件或环境主密钥、原子写入、删除、重启解密和 Windows 旧凭据一次性迁移；普通应用备份排除密文与密钥。（MAIL-002, MAIL-018, MAIL-Q04, MAIL-Q09）
- [ ] **MAIL-T015** 实现断开、撤销凭据、暂停计划、配置/运行状态清理、派生数据删除和 `mail.retention@v1`，更新备份、恢复、doctor、日志脱敏和任务诊断。（MAIL-002, MAIL-004, MAIL-007, MAIL-018, MAIL-Q04, MAIL-Q09）
- [ ] **MAIL-T016** 补齐三种连接器的脱敏协议样本及 `.eml`、HTML、日历和恶意输入夹具，完成单元、契约、SQLite 集成、Worker、Web E2E 与格式、类型、lint、依赖和文档门禁；Gmail、Graph、IMAP 分别使用隔离账号完成授权、首次回溯、增量、游标恢复、断开和重新授权在线 smoke，三者全部 supported 后才宣称 M1 完整交付。（MAIL-001, MAIL-003, MAIL-004, MAIL-005, MAIL-006, MAIL-008, MAIL-010, MAIL-011, MAIL-015, MAIL-016, MAIL-017, MAIL-Q01, MAIL-Q03, MAIL-Q05, MAIL-Q06, MAIL-Q07, MAIL-Q08, MAIL-Q09）
