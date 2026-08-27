# 000 工程基础规格

> 状态：Implemented
> 依赖：无

## 目标

建立可重复的 TypeScript workspace、包边界、统一质量命令和测试基础，使后续功能从第一项任务开始就能被构建和验证。

## 功能需求

- **ENG-001**：仓库必须声明并校验 Node.js 24 LTS、pnpm workspace 和锁文件，其他 Node 主版本不得作为受支持运行环境静默通过。
- **ENG-002**：所有包必须继承严格 TypeScript 基础配置，启用 `strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes` 和一致模块解析。
- **ENG-003**：根命令必须提供 format、lint、typecheck、test、test:integration、test:e2e、build 和 docs:check。
- **ENG-004**：包只能从其他包公开入口导入；领域包不得依赖应用层或基础设施包，自动边界检查必须阻止违规。
- **ENG-005**：测试必须区分无外部依赖单元测试、真实临时 SQLite 集成测试、显式在线 Smoke 和 Web E2E。
- **ENG-006**：默认 test/build 不得访问互联网、调用付费模型或写入真实 `var/`。
- **ENG-007**：仓库必须提供 `.env.example` 和本地配置示例，但不得包含秘密；`var/`、备份、简历、数据库和评测输出默认忽略。
- **ENG-008**：构建产物必须写入各包 `dist/`，可从干净 checkout 通过单一命令重建。
- **ENG-009**：文档检查必须验证规格三件套、状态、相对链接、重复需求 ID 和 `git diff --check` 等价规则。

## 质量需求

- **ENG-Q01**：基础命令必须可在 Windows PowerShell 和常见 POSIX shell 运行，不依赖 shell 专属串联语法。
- **ENG-Q02**：工具配置集中维护，包级覆盖必须有注释说明原因。
- **ENG-Q03**：普通测试使用固定时钟、随机种子和临时目录，不产生顺序依赖。

## 验收场景

1. 干净 checkout 安装后执行统一质量命令全部通过。（ENG-001..003,008）
2. 在 domain 添加对 db 的导入，边界检查失败并指出规则。（ENG-004）
3. 普通 test 在无网络、无模型 Key 时通过且不创建工作区 `var/`。（ENG-005,006）
4. `.env.example` 经秘密扫描无真实值，数据库/简历文件无法被默认 git add。（ENG-007）
5. 删除任一规格 tasks.md 或制造坏相对链接，docs:check 失败。（ENG-009）

## 未解决问题

无。
