# ADR-0007：Node 24 LTS 与包依赖边界

- 状态：Accepted
- 日期：2026-08-19
- 替代：ADR-0001

## 决策

首期以 Node.js 24 LTS、TypeScript 严格模式和 pnpm workspace 实现模块化单体。`packages/domain` 只包含纯领域模型、规则及 Clock/ID 等领域抽象；Repository、事务、Parser、Logger 等端口属于 `packages/application`，来源和 Agent 的可复用协议属于各自契约包。基础设施包实现端口，`apps/*` 负责最终装配。

`packages/sources` 在 R1 是一个 workspace 包，各公司为包内模块，通过编译期 Registry 注册，不加载任意第三方代码。

## 原因

Node 24 是新项目在 2026 年的当前 LTS 基线。明确端口所有权可以避免领域包被数据库、模型和文件解析概念污染，也避免应用层反向依赖具体实现。编译期 Registry 已满足新增与启停来源的扩展需求，动态插件系统会增加供应链、兼容性和配置复杂度。

## 后果

- dependency-cruiser 必须执行总体架构中的包依赖矩阵。
- `application` 只能依赖协议和业务包，不能导入 `db`、`sources`、`llm` 或 `observability` 实现。
- `apps/cli`、`apps/worker` 和 `apps/web` 可以依赖实现包完成装配，但不承载业务规则。
- 若未来需要独立发布来源插件，必须新增 ADR，定义签名、版本兼容、权限和加载隔离。
- 若出现必须使用 Python 的训练或重型 NLP，再通过稳定任务/数据端口增加服务，不改变现有领域边界。
