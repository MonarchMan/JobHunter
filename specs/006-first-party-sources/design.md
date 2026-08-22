# 006 首批企业官网来源设计

> 状态：Ready

## 交付组织

```text
packages/sources/
├─ tencent/
├─ alibaba/
├─ baidu/
├─ bytedance/
├─ pinduoduo/
├─ meituan/
├─ dewu/
├─ xiaohongshu/
├─ jd/
└─ huawei/
```

`packages/sources` 是一个 workspace 包，每个公司目录是包内模块。每个目录包含 `README.md`（复核日期、公开入口、能力与限制）、适配器、来源响应 Schema、normalize、fixtures 和测试。所有模块通过编译期 Registry 注册；不进行动态代码加载。接口路径和字段只写在对应目录，不提升为公共契约。

## 波次

- Wave A：腾讯、拼多多，先证明契约和同步闭环。
- Wave B：字节、美团、小红书、京东。
- Wave C：阿里、百度、得物、华为，先解决当前调研中的空内容/阻断不确定性。

每个初次 Spike 最长一个工作日。若普通 HTTP 无法获得公开匿名职位，可在剩余时限内验证受控浏览器方案：只执行官网公开脚本并读取匿名渲染结果，不逆向生成风控参数。若仍无法获得覆盖证据，提交 experimental/blocked source descriptor、健康检查和复核说明；该来源适配器任务保持未完成，但不阻塞主链路发布。

## 配置与种子数据

公司与来源 seed 通过幂等初始化用例写入。默认只启用通过 supported 门禁的来源；experimental/blocked 默认禁用自动计划但允许手动 health check。enabled、support status 与运行 health 不得互相推导覆盖。

## 技术策略

严格按 JSON → 页面结构化数据 → HTML → 受控浏览器降级。浏览器适配器复用单一受控 BrowserPool，禁止每个职位启动浏览器；BrowserPool 负责上下文隔离、并发上限、超时、AbortSignal、页面回收和连续失败熔断。浏览器只使用当前匿名上下文执行官网公开脚本，不注入伪造风控值、不保存登录 Cookie、不处理验证码。所有来源默认低频、带抖动串行请求；实际值由 Spike 记录。

浏览器能力属于可选基础设施。未安装浏览器运行时、会话频繁失效或采集成本超出来源 Spike 的时间预算时，适配器返回可分类错误并保持 `experimental/blocked`，Registry 跳过其自动同步，其他任务照常运行。

### 浏览器渲染采集端口（2026-08-22）

字节和得物的官网页面能够在匿名浏览器中由官网自身脚本生成请求参数并渲染职位，但裸 HTTP 列表请求依赖运行时签名。因此来源不得复制签名，而是通过 `SourcePageClient.collect` 使用同一匿名页面会话完成：打开入口、等待官网自身列表请求返回，读取响应中的 `job_post_list/count/limit/offset`，按 `ceil(count / limit)` 计算覆盖范围，并驱动官网分页控件让页面运行时继续生成下一页请求，最后返回脱敏的页面记录与 coverage。

`SourcePageClient.collect` 只返回普通 JSON 记录和分页证据，不暴露 Playwright/Page、Cookie、Storage、请求头或签名。实现层负责页面超时、取消、并发限制、资源回收和连续失败熔断；遇到登录、验证码或访问验证立即返回 `access_blocked`。来源适配器只负责把记录映射为 `DiscoveredJob` 和规范职位，不能自行生成或持久化动态令牌。

生产 Worker 通过浏览器 session factory 装配该端口；未装配时相关来源健康状态为 `unhealthy/access_blocked`。响应分页参数、稳定 ID 重复复核、字段归一化、固定样本和匿名 Smoke 通过后，来源可晋级；完整同步由运行时按 `count/limit` 自动执行，不把签名复制到配置或源码。

阿里巴巴校园实习与华为校园实习现已接入同一响应驱动采集端口：前者按 `pageIndex/pageSize` 读取 `/position/search` 的 `content`，后者按 `curPage/pageSize` 读取网关响应的 `data.pageVO`。两者均使用官网自身匿名会话生成运行时请求参数，并通过完整分页 Smoke 后标记为 `supported`。

### 百度校园 JSON 适配（2026-08-22）

百度校园页面在部分浏览器环境或打开开发者工具后会跳转空白页，但服务端仍匿名输出 SSR 数据，公开前端脚本也明确使用 `POST /httservice/getPostListNew`。适配器直接复用该匿名 JSON 协议，不依赖 DevTools 或页面 DOM：请求使用 `application/x-www-form-urlencoded`，按 `recruitType/curPage/pageSize` 分页，服务端页大小上限为 20；默认先采 `INTERN`，再采 `GRADUATE`。列表已内联职责和要求，`postId` 作为稳定外部 ID，官方详情 URL 为 `/jobs/detail/{recruitType}/{postId}`。

### BrowserPool 实现边界

首个共享实现放在 `packages/sources/src/browser/`，只依赖来源契约所需的抽象，不引入 Playwright 或其他浏览器 SDK。`BrowserPool` 接收由进程入口装配的 session factory；每次 lease 创建独立匿名 session，任务完成、超时、取消或失败时都在 `finally` 中回收 session。池本身负责全局并发上限、可取消等待队列、超时信号合并、AbortSignal 传播、每个来源的连续失败计数、冷却期熔断和成功复位。

Session 的创建与关闭留在 factory 内，避免浏览器对象泄露到 application/domain。BrowserPool 不负责登录、Cookie 持久化、验证码处理或风控参数生成；没有可用浏览器 runtime 时由装配层不提供 factory，来源按既有 `experimental/blocked` 降级路径运行。

浏览器基础设施只校验分页响应外壳并输出中立记录；阿里、字节、得物和华为适配器还必须在发现与归一化边界使用各自 Zod Schema 再次校验职位记录。小红书 JSON 来源遵循同一规则。共享适配器不得仅凭候选字段存在就接受外部数据；逐来源 Schema 失败统一分类为 `parse_changed`，使同步层保留最后成功数据并禁止基于本次缺失关闭职位。

## 测试与上线

固定样本测试是合并门禁；在线 Smoke 是标记 supported 的发布门禁。在线结果记录 run ID、日期、入口、发现数量区间和 coverage，不提交原始个人信息或认证数据。

浏览器来源在线 Smoke 位于 Worker 测试目录，由 Worker 的 Playwright session factory 装配 `SourcePageClient`，避免 `packages/sources` 依赖浏览器 SDK。测试必须同时设置 `JOBHUNTER_ONLINE_SOURCES=1` 和单来源选择器 `JOBHUNTER_BROWSER_ONLINE_SOURCE=alibaba|bytedance|dewu|huawei`；默认及未指定选择器时跳过。每次最多采集两页，仅验证真实匿名会话、分页响应、逐来源 Schema、稳定 ID、官方 URL 和归一化，不替代低频全量覆盖门禁。
