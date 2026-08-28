# 019 非 supported 官网渠道闭环设计

> 状态：In Progress

## 推进单元

每个逻辑渠道作为一个可独立验收的推进单元：研究官方入口，确认物理协议与故障域，保存脱敏 fixture，实现或复用协议，运行离线契约和在线 2–3 页 smoke，最后才更新支持状态。共享协议只能复用传输和 Schema，渠道筛选与门禁仍各自存在。

## 优先级

1. 已有真实 adapter 的 9 个 experimental：先补独立渠道门禁、完整性或访问验证问题。
2. 能从现有官网协议安全拆分的 blocked：百度社招、美团校招、京东校招、华为校招/社招，以及 vivo、OPPO 的其他项目。
3. 需要新浏览器会话或新官网协议的 blocked：阿里社招、拼多多校招/社招、得物社招、小红书社招、小米校招/社招、360 校园、网易三个校招官网。

## 证据状态

`research.md` 是逐渠道权威台账。状态只能按以下顺序前进：

```text
unresearched -> endpoint_found -> fixture_verified -> offline_passed -> online_smoke_passed -> supported
                                  \-> access_blocked / no_public_channel
```

`access_blocked` 和 `no_public_channel` 是待解决事实，不是完成状态。

## 浏览器边界

浏览器只负责访问公开页面、运行官网脚本并捕获官方 JSON/GraphQL 响应。不得从 DOM 猜测分页完整性；若官网只提供 DOM，则必须同时证明分页边界、稳定岗位链接和总数一致性。验证码、登录或设备验证出现时立即停止并记录 `access_blocked`。

## 拼多多签名 Spike 边界

拼多多社招的首选研究方向是复用官网公开 bundle 中的原始签名模块，而不是自行设计 `anti_content` 算法。按以下顺序验证：

1. 定位官网请求包装器、服务器时间接口和实际签名模块，固定 bundle URL 与摘要，建立变更检测。
2. 在空白匿名会话中只记录 token 长度、摘要和调用结果，不保存或提交 token 明文；证明列表与详情均逐请求生成，排除 token 重放。
3. 尝试把官网模块放入短生命周期的隔离签名运行时。运行时可以使用官网自身代码和匿名状态，但不得注入 stealth、修改 `navigator.webdriver`、导入用户 Cookie 或处理验证码。
4. 若模块不能脱离完整浏览器 API、风控侧链或事件状态稳定运行，则停止 Node/DOM shim 方向，采用普通 Chrome 首屏后由 Playwright CDP 接管的 session-driven driver 作为 fallback。

实验已证明原始模块可以脱离招聘页面和 Next.js runtime，但不能在不伪造屏幕与浏览器指纹的情况下脱离真实 Chrome。当前主候选因此收敛为：从公开 HTML 定位并校验 `_app` bundle，以 AST 抽取原始 factory，在外部启动的原生 `--headless=new` Chrome 同源最小页中运行，Playwright 只通过 CDP 管理生命周期和调用。bundle 摘要或模块拓扑变化时不得猜测模块 ID，应关闭主路径并回退完整官网页面驱动。

主路径与 fallback 必须共享每公司串行限流和断路器；`54001`、`400023`、验证码、总数突变为 0 或连续签名失败均立即结束 SyncRun，不能在同一风险窗口中切换方案反复请求。

该 Spike 尚未决定生产技术选型，因此不新增 ADR；若验证后决定引入签名运行时，再补 ADR，明确 bundle 更新、隔离、失败回退、合规与维护责任。

## 晋级门禁

一次晋级提交必须同时包含 catalog 状态、Registry、fixture、离线测试、在线测试和支持矩阵证据。在线 smoke 默认采集首页与末页，可增加一个中间页；输出至少记录时间、采样页码、首页/末页总数、样本唯一 ID 数、`partial + sampled_pages`、详情/归一化结果和协议限制。无需为晋级遍历全部页。
