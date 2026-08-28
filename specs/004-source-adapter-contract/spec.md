# 004 官网来源适配器契约规格

> 状态：Implemented
> 依赖：001

## 目标

定义可插拔官网来源 SDK，使新增公司或 ATS 不修改同步、职位、匹配和展示模块。

## 非目标

- 不定义某家公司接口细节。
- 不负责持久化、重试、关闭判断或 Agent 调用。
- 不绕过登录、验证码或访问控制。

## 功能需求

- **SRC-001**：适配器必须声明唯一 key、公司/招聘类型、能力、默认限速和规范入口。
- **SRC-002**：`discover` 必须异步迭代职位引用，并报告分页完成度和可继续游标。
- **SRC-003**：适配器必须把详情能力声明为 `inline` 或 `deferred`。`inline` 表示列表记录足以形成完整标准化输入；`deferred` 必须能仅凭列表记录形成合法基础职位，并可通过 `fetchDetail` 在独立任务中补全，不得在列表同步中请求详情。
- **SRC-004**：`normalize` 必须输出统一 NormalizedJob，缺失事实为 null/空集合，不能猜测。
- **SRC-005**：适配器必须提供稳定 externalJobId；降级指纹算法必须有版本。
- **SRC-006**：detailUrl 和 applyUrl 必须是官方 HTTPS URL，并移除会话标识和跟踪参数。
- **SRC-007**：所有网络方法必须接受 AbortSignal、超时和来源请求上下文。
- **SRC-008**：错误必须分类为 temporary、rate_limited、not_found、access_blocked、parse_changed、invalid_config。
- **SRC-009**：healthCheck 必须以最小请求验证入口和关键解析信号，不执行完整同步。
- **SRC-010**：每个适配器必须通过公共契约测试及脱敏固定样本测试。
- **SRC-011**：适配器在 normalize 边界必须将外部职位类别映射为内部大标签；可识别的岗位方向同时输出小标签，无法识别的大标签归入“其他”。
- **SRC-012**：partial/unknown completion 必须提供结构化覆盖证据，包括可得的预期总数、实际数量、页数、重复数、原因码和是否适合重试；不得只返回无原因的 partial。

## 质量与合规需求

- **SRC-Q01**：优先使用公开 JSON/结构化数据，其次 HTML，最后浏览器。
- **SRC-Q02**：不得使用登录态、Cookie、验证码规避或指纹对抗，除非未来经独立规格和用户授权。
- **SRC-Q03**：适配器不得直接导入数据库、Agent、匹配或进程入口包。
- **SRC-Q04**：固定样本不得包含 Token、Cookie、候选人信息或非职位个人信息。

## 验收场景

1. 固定列表两页产生稳定顺序的职位引用并报告 complete。（SRC-002）
2. 第二页解析失败时报告 partial，不伪装 complete。（SRC-002,008）
3. 同一原始职位重复 normalize 输出完全相同和相同 ID。（SRC-004,005）
4. URL 含 `jsessionid`/utm 时输出规范官方 URL。（SRC-006）
5. 触发 AbortSignal 后网络请求和迭代在超时内终止。（SRC-007）
6. 页面关键选择器消失时返回 parse_changed 和脱敏诊断。（SRC-008）
7. 出现验证码或 403 防护时返回 access_blocked，不尝试规避。（SRC-Q02）
8. deferred 来源的列表发现与基础 normalize 不调用详情接口；详情补全在独立任务中执行。（SRC-003）
9. 总数漂移或重复 ID 导致 partial 时返回可持久化、可判断重试的覆盖证据。（SRC-012）

## 未解决问题

无。
