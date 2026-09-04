# AGENTS.md

本文件仅定义仓库级工程规则。更具体的行为、数据和功能要求以 `specs/` 中对应规格为准。

## 1. 保持模块化单体和单向依赖。

`apps/` 只放进程入口与装配代码，`packages/application` 编排用例并声明 Repository 等应用端口，`packages/domain` 只保存纯领域模型、规则以及 Clock/ID 等领域级抽象；来源、Agent 等可复用协议放在对应契约包。基础设施实现端口但不得被应用层反向导入，领域层不得依赖应用、数据库、浏览器、模型 SDK 或任何进程入口；跨包调用只能使用包的公开入口。

## 2. 遵守目录职责。

可执行入口放入 `apps/cli`、`apps/worker` 或 `apps/web`；共享能力按职责放入 `packages/`；总体设计与决策放入 `docs/arch` 和 `docs/adr`；功能规格放入 `specs/`；脱敏测试样本放入 `fixtures/`；本地运行数据放入不提交版本库的 `var/`。不要在仓库根目录堆放实现文件，也不要让一个目录同时承担入口、领域和基础设施职责。

## 3. 按 SDD 推进变更。

新能力先建立或更新 `spec.md`、`design.md` 和 `tasks.md`，再实现代码与测试；影响依赖方向、数据所有权、进程职责或核心技术选型的变更，必须先更新总体架构并新增 ADR。实现、测试和文档应引用同一术语与验收标准。

## 4. 维持统一工程约束。

使用 TypeScript 严格模式和 pnpm workspace；外部输入与模型输出在边界处进行运行时校验；持久化通过仓储端口访问；网络或模型调用不得发生在数据库事务内；耗时及可重试工作交给 Worker；每项变更至少运行与风险相匹配的格式检查、类型检查和自动化测试。

代码必须配有必要的中文注释：函数、类、接口、类型等定义应说明其职责、关键输入输出和重要不变量；函数内部对关键分支、数据转换、事务边界、外部调用、安全限制或不易从代码直接看出的设计原因进行注释。函数内部存在业务逻辑流程时，必须用中文注释明确执行顺序，使用“1、2、3……”表示主步骤；存在分支或子步骤时，使用“1.a、1.b……”等二级序号。注释应解释“为什么”以及必要的业务语义，不要为显而易见的语法逐行添加注释；代码变更时必须同步更新受影响的注释。示例：

```ts
/** 保存简历文件并创建后续画像提取任务的应用服务。 */
export class ResumeImportService {
  /** 文件落库和解析完成后，才登记可供 Worker 消费的文档记录。 */
  public async import(bytes: Uint8Array): Promise<ResumeImportResult> {
    // 1. 文件写入、文本解析和模型调用均在数据库事务之外执行。
    const artifact = await this.artifacts.put(bytes);
    // 2. 文件完成保存后登记文档，供后续画像提取任务消费。
    return this.documents.createOrGet(artifact);
  }
}
```

## 5. 统一 Git 提交说明。

提交信息首行使用一句简洁、完整的话概括本次提交的主要目的；空一行后，在正文中按 Conventional Commits 类型逐项展开实际变更，格式为 `<type>(<scope>): <description>`。优先使用 `feat`（新增功能）、`fix`、`docs`、`refactor`、`test`、`chore`、`build`、`ci`、`perf`、`style` 或 `revert`，不要使用含义不够标准的 `add` 代替 `feat`。只列出本次提交真实包含的类型，描述使用明确的动宾短语；存在不兼容变更时按 Conventional Commits 使用 `!` 并在正文中补充 `BREAKING CHANGE:`。示例：

```text
完善简历制作页的直接编辑与导出体验

feat(resume-studio): 支持在简历画布中直接编辑字段
fix(resume-import): 将专业技能归一化为完整句子列表
test(resume-studio): 覆盖工具栏与画布中心对齐
docs(spec): 同步简历制作交互规范
```
