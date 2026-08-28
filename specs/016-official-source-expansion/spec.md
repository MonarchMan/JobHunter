# 016 官网来源扩展与目录分层规格

> 状态：Implemented
> 依赖：004, 005, 006

## 目标

在保持现有官网来源稳定标识和运行行为不变的前提下，将 `packages/sources` 按公司与招聘渠道分层，并接入小米、vivo、OPPO、360、网易五家公司当前公开的官方招聘来源。

## 非目标

- 不接入第三方聚合职位或非官方镜像。
- 不登录、不复用候选人 Cookie、不处理验证码、不伪造风控参数。
- 不因目录迁移改变既有 adapter key、source slug、UUID、默认配置或支持状态。

## 需求

- **OSE-001**：来源实现按 `companies/<company>/<channel>` 组织；公司协议不得由共享模块反向拥有。
- **OSE-002**：共享目录只保存浏览器、HTTP、分页和归一化机制，不保存公司 URL、请求参数或字段映射。
- **OSE-003**：catalog 的公司 UUID、来源 UUID 与来源配置必须写在同一条显式记录中，不得依赖平行数组下标对齐。
- **OSE-004**：目录迁移本身保持现有 13 个来源的 adapter key、source slug、公司/来源 UUID、默认启用状态和运行行为；后续 `017-three-channel-sources` 为修正频道语义而显式 canonicalize 的 key/slug 除外。
- **OSE-005**：新增小米实习、vivo 社招、OPPO 实习、360 社招和网易混合社招来源；每个来源拥有独立 adapter key、source slug、UUID、Schema、fixture 和契约测试。
- **OSE-006**：外部响应必须在来源边界使用逐来源 Zod Schema 校验；分页总数变化、缺页或重复稳定 ID 必须报告 `partial`。
- **OSE-007**：职位必须使用稳定官方 external ID 和岗位级官方 detail/apply URL；不得回退到招聘首页或列表页。
- **OSE-008**：招聘类别优先使用记录级招聘类型，其次仅使用职位名称，最后回退来源类型；网易职位名含“实习”时归为 `internship`。
- **OSE-009**：直接匿名 JSON 可闭合分页、稳定 ID、字段和深链的来源才能标记 `supported` 并默认启用。
- **OSE-010**：需要浏览器初始化匿名会话的来源必须复用 `SourcePageClient`；浏览器只捕获官方 JSON，不解析职位 DOM，不点击 DOM 翻页。
- **OSE-011**：在线 Smoke 默认跳过并可按单来源选择；离线测试不得访问官网。
- **OSE-012**：目录和 catalog 重组必须通过 sources 单元测试、数据库 seed 幂等测试、类型检查和依赖边界检查。

## 验收场景

1. Registry 仍注册全部既有 key，旧 catalog 稳定字段逐项不变。（OSE-003,004）
2. 新增五家公司均可由 catalog 找到已注册适配器；支持状态和默认启用严格一致。（OSE-005,009）
3. 小米、vivo、OPPO、网易固定样本完成全量分页契约；360 未通过会话与详情门禁时保持 experimental 且默认关闭。（OSE-006,009,010）
4. 网易实习职位归一化为 internship，普通社招描述中出现“实习”不改变类别。（OSE-008）
5. 任一新来源响应漂移时返回 `parse_changed`，partial 同步不关闭既有职位。（OSE-006）

## 未解决问题

无。支持状态由定向在线门禁决定；门禁未闭合的来源保持 `experimental`，不作为规格未决项。
