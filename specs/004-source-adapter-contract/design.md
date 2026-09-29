# 004 官网来源适配器契约设计

> 状态：Implemented

快手分页校验输出有界 duplicateJobSamples 和复查页码。Worker 对全量分页的重复涉及页进行一次有限重读，替换旧页后从原始页集合重新验证总数、页边界与唯一 ID 数；不将两次分页结果并集作为完整性证据。复查最多 4 页，共享原请求截止时间与 5 秒间隔；持续重复仍保留 partial，不无限重试。

## Worker 官网浏览器生命周期

Worker 入口拥有可关闭的 Playwright 来源客户端，在主循环退出或初始化失败的 finally 中释放。客户端持有单个浏览器启动 Promise，失败清空，断开后由下一请求重建；浏览器池仍负责排队和熔断。每个请求独立 BrowserContext，在请求完成/失败后关闭，进程保留至 Worker 退出。退出状态在等待启动前设置，防止晚到启动泄漏。共享能力仅在 Worker 基础设施中实现，不改变应用端口或依赖方向。

## 包结构

```text
packages/source-core/
├─ contract.ts
├─ registry.ts
├─ errors.ts
├─ http-client.ts
├─ url-policy.ts
├─ contract-testkit.ts
└─ index.ts

packages/sources/<source-key>/
├─ adapter.ts
├─ schemas.ts
├─ normalize.ts
├─ fixtures/
└─ adapter.test.ts
```

## 契约

`discover` 返回 `DiscoveryPageEvent | DiscoveredJob` 流，结束事件包含 coverage、cursor、统计和覆盖诊断；异常退出由公共同步层视为 partial。适配器不保存游标。详情 capability 仅允许 `inline/deferred`：deferred 适配器的 `normalize({ detail: null })` 必须输出列表基础职位，`fetchDetail` 只由独立详情任务调用。

公共 `SourceHttpClient` 统一 User-Agent 项目标识、超时、响应大小上限、基础限速挂钩和脱敏错误；不自动无限重定向。浏览器实现通过同一端口提供页面快照，不把 Playwright 类型暴露到 Adapter 接口。

NormalizedJob 的规范哈希由领域层计算。适配器只输出来源字段、sourcePrivateJson 和 provenance map；provenance 指明每个标准字段来自哪个原始路径。

## 注册

Registry 在启动时验证 key 唯一且配置 Schema 可解析。来源数据库行通过 adapterKey 找到实现；缺失实现属于 invalid_config，不静默跳过。

## 契约测试套件

`defineSourceContractSuite(factory, fixtures)` 复用以下测试：稳定 ID、URL 规范、缺失字段、分页完成度、取消、错误分类、规范化稳定性和敏感样本扫描。

在线 smoke 单独标记，默认测试命令不访问互联网。

# 职位族分类

适配器不得把各官网的原始类别直接暴露给应用层。normalize 使用共享词典输出 `jobFamily`（大标签）与 `jobSubfamily`（小标签），当前大标签包括研发、产品、设计、运营、销售、职能、市场、数据、测试、其他。小标签仅在能从来源字段可靠识别时填写，否则为 null；未知大标签统一为“其他”。
