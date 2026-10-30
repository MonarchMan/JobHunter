# 000 工程基础设计

> 状态：Implemented

## 根工具链

- Node.js >=24，通过 `package.json.engines` 声明最低版本，不配置版本阻断 preinstall；doctor 检查最低版本并提供升级建议（ADR-0058）。
- pnpm 通过 `package.json.engines` 声明 `>=11.0.0` 的兼容范围，避免把开发环境绑定到单个补丁版本。
- pnpm workspace 与 `pnpm-lock.yaml`。
- TypeScript、typescript-eslint、ESLint、Prettier、Vitest。
- dependency-cruiser 检查包和层级依赖。
- `tsx` 用于开发入口；正式构建使用 `tsc -b`，应用若需打包再由对应规格增加。

## Workspace 源码开发

内部 workspace 包在 `package.json#exports` 中提供标准 `development` 条件，指向对应的 `src/*.ts` 公开入口；既有 `types` 和 `import` 条件继续指向 `dist/`，因此编辑器、正式构建与生产运行的产物契约保持不变。

Web 开发启动器只在 development 模式为 Next 与 Worker 子进程追加 `--conditions=development`，并保留调用方已有的 `NODE_OPTIONS`。这样 `tsx` Worker 和 Next 开发编译器都直接消费 workspace 源码，不要求启动前存在 `dist/`。production 模式不追加该条件，继续执行已构建 JavaScript。

Worker 自建的本地子进程也必须遵守同一模式：源码 Worker 通过仓库 `tsx` 执行相邻 `.ts` 入口，构建后的 Worker 执行相邻 `.js` 入口，不能从源码目录反向硬编码依赖 `dist/`。

`pnpm --filter @jobhunter/web dev` 不运行同步前置构建。需要持续类型反馈时，开发者在独立终端运行根 `typecheck:watch` 或 Web 包的 `dev:typecheck`；一次性 `typecheck`、正式 `build` 与统一 `check` 仍保持原有质量门禁。

## 职责化公开入口

内部包保留既有根入口作为兼容层，同时通过 `package.json#exports` 暴露职责子路径。子路径统一使用 `development` 指向源码、`types/import` 指向构建产物；调用方只导入当前页面、路由或装配职责需要的入口，避免 ESM barrel 在模块求值时递归加载无关实现。

来源目录数据与适配器注册表分离：Web 只从 `@jobhunter/sources/catalog-data` 读取静态种子，Worker 可继续使用包含具体适配器的运行时入口。邮箱连接器将不依赖协议实现的 metadata、配置存储、OAuth 工具和完整 runtime 分开，Web 设置装配不得为三条固定 metadata 实例化 Gmail、Graph 和 IMAP connector。简历包将媒体识别、解析器、OCR 和画像/润色能力拆为独立子路径，使只处理媒体错误或 Schema 的路由不会加载 `pdfjs-dist`、Tesseract、Mammoth 等解析运行时。

Application 与 DB 按 config、contracts、jobs、profile、interview、tasks、platform 等职责公开入口。Web 生产代码不得继续引用 `@jobhunter/application/web`、`@jobhunter/db/web`、`@jobhunter/sources` 或 `@jobhunter/mail-connectors` 粗入口；旧入口只服务渐进迁移和外部兼容，不作为新增代码默认入口。

## 根目录产物

```text
package.json
pnpm-workspace.yaml
tsconfig.base.json
tsconfig.json
eslint.config.js
.prettierrc.json
.dependency-cruiser.cjs
vitest.workspace.ts
.env.example
.gitignore
scripts/check-docs.mjs
```

workspace 只匹配 `apps/*` 和 `packages/*`。`packages/sources/<company>` 是单一 `packages/sources` 包内模块，不是嵌套 workspace 包。每个 workspace 包必须有 name、private、exports、types、scripts 和 composite tsconfig。

## 质量命令

根 scripts 使用 pnpm recursive/filter，而不使用依赖 shell 的 `&&`。`check` 聚合 format:check、lint、typecheck、test 和 docs:check；integration/e2e/online smoke 分开，避免默认命令产生外部副作用。`typecheck:watch` 直接复用 TypeScript project references 的增量 watch，不与开发服务生命周期耦合。

## 产物清理

`scripts/clean.mjs` 使用显式目录白名单：根及 workspace 的测试报告、coverage，Web 的 `.next/cache`、`.next/dev/cache` 和 `.next-browser-fixture`／带运行 ID 的测试目录。缓存模式保留正式编译结果；完整模式额外移除 `.next`、各包 `dist` 和 `tsconfig.tsbuildinfo`。删除前验证绝对路径在仓库内，并拒绝路径上的符号链接或 junction，避免影响外部目录。不存在的目标可重复清理。不会自动停止服务，也不会在开发或测试运行中自动清理。

## 文档检查

`scripts/check-docs.mjs` 只读扫描 Markdown：

- 自动发现所有 `specs/[0-9][0-9][0-9]-*` 目录并验证三件套存在，不硬编码当前最大编号。
- 顶部状态是否合法。
- Requirement/Task ID 是否全局唯一。
- 相对 Markdown 链接目标是否存在。
- Ready 规格是否含“未解决问题：无”。
- specs index 是否覆盖全部目录。

## 测试隔离

testkit 提供 temp data root、FakeClock、SeededRandom、FakeModel 和 fixture loader。每个测试独占目录并在进程结束清理；真实个人数据路径在测试配置解析时被拒绝。
