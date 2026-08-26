# 字节跳动官网来源

- 复核日期：`2026-08-22`
- 入口：<https://jobs.bytedance.com/experienced/position?limit=100>
- 状态：`supported`，默认启用
- 证据：匿名 Edge/Chromium 会话加载官网页面后，由官网自身前端生成运行时 `_signature` 并返回 `data.job_post_list`、`data.count`；`limit=100` 时返回约 `10000` 个职位，分页请求的 `offset` 已在两页 Smoke 中校验。
- 契约样本：`test/fixtures/bytedance/collection.json`，SHA-256 `96e086f7bf28935f8601912a5be5fc7cb895b6f96ba0e17c779b65637d0a77b3`；包含两页分页边界，逐来源 Zod 记录 Schema 和公共来源契约测试已启用。
- 采集：浏览器会话初始化时捕获官网首个 JSON 请求的必要上下文，后续在同一页面上下文中直接复用会话、请求头和签名模板发送 JSON 分页请求，不解析职位 DOM、不点击 DOM 分页；按 `ceil(count / limit)` 计算覆盖范围，稳定 ID 和官方详情链接通过归一化测试。
- 边界：出现验证码、登录或访问验证时返回 `access_blocked`；浏览器运行时可通过 `JOBHUNTER_BROWSER_EXECUTABLE` 或本机 Edge/Chrome 探测配置。

## 校园与实习来源

- 权威入口：<https://jobs.bytedance.com/campus/position>
- 适配器：`bytedance.campus`，来源 slug `bytedance-intern`
- 复核日期：`2026-08-23`
- 状态：`supported`，默认启用
- 协议：正常匿名浏览器入口返回 200，首个官方 JSON 请求使用 `portal_type=3`；响应 `count=7444`，按 `limit/offset` 直接分页。项目包含日常实习、ByteIntern、前沿技术领域人才实习招聘和 Seed 大模型人才实习招聘。
- 分类：使用 `recruit_type.parent.name + recruit_type.name` 区分校园正式岗位和实习岗位；`city_list[].name` 与 `job_category` 在来源边界展开，不读取职位 DOM。
- 定向同步：发现 7444 条，入口策略保存 4652 条，其中实习 3157 条、校招 1495 条；跳过境外 6 条、超出简历意向 2778 条、地域不明 8 条。
