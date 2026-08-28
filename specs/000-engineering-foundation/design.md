# 000 工程基础设计

> 状态：Implemented

## 根工具链

- Node.js 24 LTS，通过 `package.json.engines`、`packageManager` 和跨平台 preinstall 检查。
- pnpm workspace 与 `pnpm-lock.yaml`。
- TypeScript、typescript-eslint、ESLint、Prettier、Vitest。
- dependency-cruiser 检查包和层级依赖。
- `tsx` 用于开发入口；正式构建使用 `tsc -b`，应用若需打包再由对应规格增加。

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

根 scripts 使用 pnpm recursive/filter，而不使用依赖 shell 的 `&&`。`check` 聚合 format:check、lint、typecheck、test 和 docs:check；integration/e2e/online smoke 分开，避免默认命令产生外部副作用。

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
