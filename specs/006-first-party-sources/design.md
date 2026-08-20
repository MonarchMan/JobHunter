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

## 测试与上线

固定样本测试是合并门禁；在线 Smoke 是标记 supported 的发布门禁。在线结果记录 run ID、日期、入口、发现数量区间和 coverage，不提交原始个人信息或认证数据。
