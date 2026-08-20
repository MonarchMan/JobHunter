# 004 官网来源适配器契约设计

> 状态：Implemented

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

`discover` 返回 `DiscoveryPageEvent | DiscoveredJob` 流，结束事件包含 coverage、cursor 和统计；异常退出由公共同步层视为 partial。适配器不保存游标。

公共 `SourceHttpClient` 统一 User-Agent 项目标识、超时、响应大小上限、基础限速挂钩和脱敏错误；不自动无限重定向。浏览器实现通过同一端口提供页面快照，不把 Playwright 类型暴露到 Adapter 接口。

NormalizedJob 的规范哈希由领域层计算。适配器只输出来源字段、sourcePrivateJson 和 provenance map；provenance 指明每个标准字段来自哪个原始路径。

## 注册

Registry 在启动时验证 key 唯一且配置 Schema 可解析。来源数据库行通过 adapterKey 找到实现；缺失实现属于 invalid_config，不静默跳过。

## 契约测试套件

`defineSourceContractSuite(factory, fixtures)` 复用以下测试：稳定 ID、URL 规范、缺失字段、分页完成度、取消、错误分类、规范化稳定性和敏感样本扫描。

在线 smoke 单独标记，默认测试命令不访问互联网。
