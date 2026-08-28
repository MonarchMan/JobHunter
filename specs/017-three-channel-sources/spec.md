# 017 官网三渠道来源规格

> 状态：Implemented
> 依赖：004, 005, 006, 016

> 演进说明：本规格记录 017 实施时的扁平 catalog 约束。自 018 起，TCS-001、TCS-002、TCS-007、TCS-008 的持续语义作用于逻辑渠道；物理来源改为 `0..N`，其数量、slug 和 adapter key 由真实官网拓扑决定。

## 目标

保证 catalog 中每家公司都显式拥有实习、校招、社招三个独立官网来源，并且每个来源都有稳定 UUID、唯一 adapter key、独立开关和真实支持状态。

## 需求

- **TCS-001**：每家公司必须且只能拥有 `intern`、`campus`、`social` 三个 canonical channel source。
- **TCS-002**：三渠道 source slug 和 adapter key 分别以 `-intern/.intern`、`-campus/.campus`、`-social/.social` 结尾。
- **TCS-003**：每个 catalog adapter key 都必须在 Registry 注册，UUID、slug 和 key 全局唯一。
- **TCS-004**：已验证的真实协议继续使用实际适配器；不得为了凑齐渠道而把其他渠道职位伪装成目标渠道。
- **TCS-005**：官网没有公开对应渠道、协议未完成或访问门禁未闭合时，来源必须标记 `blocked` 或 `experimental`、默认关闭，并由明确的不可用适配器返回 `access_blocked`。
- **TCS-006**：`mixed` 不能作为 canonical channel；混合列表必须在来源边界拆成三个独立渠道，或在尚未拆分时保留内部实现但不得进入 catalog。
- **TCS-007**：Web 来源必须稳定暴露与 canonical adapter key 一致的单一频道，不得把一个 source 同时展示为多个频道。
- **TCS-008**：数据库 seed 必须幂等地产生 15 家公司、45 个来源，且不覆盖运行时开关和健康状态。
- **TCS-009**：离线测试必须证明三渠道矩阵、Registry 一致性、不可用来源失败语义和既有来源稳定标识。

## 验收场景

1. 将 catalog 按公司分组，每组严格得到 `intern/campus/social`，总计 45 条来源。（TCS-001, TCS-008）
2. 每个来源可从 Registry 解析配置；blocked 来源 discovery 返回 `access_blocked`，不会报告空列表成功。（TCS-003, TCS-005）
3. 既有真实适配器仍通过原契约，新增占位渠道不默认启用。（TCS-004, TCS-009）
4. 网易 mixed 实现不再作为 catalog source，三个 canonical channel 分别建模。（TCS-006）

## 未解决问题

无。未验证渠道的事实状态由 `blocked` 显式表达，后续完成官网 Spike 后可独立提升，不影响三渠道模型成立。
