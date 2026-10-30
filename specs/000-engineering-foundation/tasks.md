# 000 工程基础任务

> 状态：Implemented
> 显式覆盖：ENG-001, ENG-002, ENG-003, ENG-004, ENG-005, ENG-006, ENG-007, ENG-008, ENG-009, ENG-010, ENG-011, ENG-Q01, ENG-Q02, ENG-Q03, ENG-Q04, ENG-Q05

- [x] **ENG-T001** 创建根 package、pnpm workspace、Node 版本声明和锁文件。（ENG-001）
  - 2026-10-29：Node 支持范围放宽为 >=24，移除安装版本阻断，doctor 与文档同步最低版本并覆盖 Node 26 回归。
  - 2026-10-13：将 pnpm 约束由固定补丁版本调整为 `>=11.0.0`，允许兼容的新版本直接执行 workspace 命令。
  - 2026-10-14：`.node-version` 改为本地工具配置，不再提交版本库；项目支持范围继续以 `package.json#engines` 为准。
- [x] **ENG-T002** 创建严格 TypeScript 基础配置、包模板和 project references。（ENG-002,008）
- [x] **ENG-T003** 配置 ESLint、Prettier、Vitest 和统一根命令。（ENG-003, ENG-Q02）
  - 2026-10-25：扩展完整清理范围，并新增保留编译产物的缓存清理命令；通过临时目录验证保留数据、重复清理和目录链接防护。
- [x] **ENG-T004** 配置 dependency-cruiser 的公开入口和分层规则，并添加故意违规 fixture 测试。（ENG-004）
- [x] **ENG-T005** 建立单元/集成/E2E/online smoke 分层与 testkit 临时目录。（ENG-005,006, ENG-Q03）
- [x] **ENG-T006** 创建 `.gitignore`、唯一运行配置模板 `.env.example`，并运行秘密扫描。（ENG-007）
- [x] **ENG-T007** 实现 `scripts/check-docs.mjs` 和坏链接/重复 ID/缺文件测试。（ENG-009）
- [x] **ENG-T008** 在 Windows PowerShell 与 POSIX 环境验证所有根命令不依赖 shell 串联。（ENG-Q01）
  - 2026-08-21：根脚本静态门禁、`run-checks.mjs` 的 `shell: false`、Windows PowerShell 运行和 Git Bash POSIX 实跑均通过；Git Bash 使用 `D:\common\Git\bin\bash.exe`、Node 24.19.0、pnpm 11.19.0 执行 `pnpm check`、`test:integration`、`test:e2e` 和 `build`。
  - Git Bash 结果：`pnpm check` 通过（128 个单测、依赖边界、类型和文档检查），集成测试 64/64，E2E 33/33，构建通过。
  - 2026-10-13：浏览器描述文件发现按目标平台分别使用 POSIX／Windows 路径规则，测试在 Windows 宿主模拟 macOS、Linux 时不再受宿主分隔符影响。
- [x] **ENG-T009** 为内部包增加 development 源码导出，移除 Web 开发前的全仓构建，并提供独立增量类型检查及源码解析回归测试。（ENG-010, ENG-Q04）
  - 2026-10-16：Web 开发入口不再执行 `predev`，Next 与独立 Worker 通过 `development` 条件解析 workspace `src`；实测命令 128ms 进入入口、约 1.6 秒 Ready，SSR chunk 确认来自 `packages/*/src`。独立 `typecheck:watch` 首轮 0 错误；类型检查、构建、依赖边界、文档检查、源码/生产解析测试与 Web 启动策略测试通过。完整单测 1070/1071，通过项之外仅既有 Playwright PDF 用例在全套并发下超过 5 秒，单独复跑 2/2 通过。
- [x] **ENG-T010** 拆分 application、db、sources、mail-connectors 与 resume 的职责公开入口，迁移 Web 生产代码并增加轻量模块图回归门禁。（ENG-011, ENG-Q05）
  - 2026-10-16：Web 生产代码不再导入四个粗粒度入口；来源目录、邮箱 metadata 和 OCR 契约的模块图门禁可阻止适配器、IMAP/MIME、Tesseract 被误加载。独立冷缓存实测 Next Ready 720ms，首页首次请求 4.1 秒（Next 编译 3.3 秒、应用代码 753ms），后续请求 77ms；开发 JS chunk 从基线 118 个/约 36.8MB 降至 77 个/约 17.8MB。
