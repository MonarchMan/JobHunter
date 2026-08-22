# 000 工程基础任务

> 状态：Implemented
> 显式覆盖：ENG-001, ENG-002, ENG-003, ENG-004, ENG-005, ENG-006, ENG-007, ENG-008, ENG-009, ENG-Q01, ENG-Q02, ENG-Q03

- [x] **ENG-T001** 创建根 package、pnpm workspace、Node 版本检查和锁文件。（ENG-001）
- [x] **ENG-T002** 创建严格 TypeScript 基础配置、包模板和 project references。（ENG-002,008）
- [x] **ENG-T003** 配置 ESLint、Prettier、Vitest 和统一根命令。（ENG-003, ENG-Q02）
- [x] **ENG-T004** 配置 dependency-cruiser 的公开入口和分层规则，并添加故意违规 fixture 测试。（ENG-004）
- [x] **ENG-T005** 建立单元/集成/E2E/online smoke 分层与 testkit 临时目录。（ENG-005,006, ENG-Q03）
- [x] **ENG-T006** 创建 `.gitignore`、`.env.example` 和非敏感配置示例，运行秘密扫描。（ENG-007）
- [x] **ENG-T007** 实现 `scripts/check-docs.mjs` 和坏链接/重复 ID/缺文件测试。（ENG-009）
- [x] **ENG-T008** 在 Windows PowerShell 与 POSIX 环境验证所有根命令不依赖 shell 串联。（ENG-Q01）
  - 2026-08-21：根脚本静态门禁、`run-checks.mjs` 的 `shell: false`、Windows PowerShell 运行和 Git Bash POSIX 实跑均通过；Git Bash 使用 `D:\common\Git\bin\bash.exe`、Node 24.19.0、pnpm 11.19.0 执行 `pnpm check`、`test:integration`、`test:e2e` 和 `build`。
  - Git Bash 结果：`pnpm check` 通过（128 个单测、依赖边界、类型和文档检查），集成测试 64/64，E2E 33/33，构建通过。
