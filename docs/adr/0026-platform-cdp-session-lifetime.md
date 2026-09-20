# ADR-0026：平台 CDP 连接与用户活动会话同寿命

- 状态：Accepted
- 日期：2026-09-19
- 关联规格：[028 招聘平台来源](../../specs/028-recruitment-platforms/spec.md)

## 背景

真实 Chrome 在每次新建 CDP 连接时要求确认。ADR-0025 的读取后立即断开策略导致重复授权，20 秒等待也不足以覆盖人工确认。

## 决策

替代 ADR-0025 第 3 项中“尽快断开”的生命周期要求：一次显式 connect 持有一个本机 CDP WebSocket，直至用户断开、替换连接或 Worker 退出。只在初始化读取指定 BOSS 页上下文及适用 Cookie，随即 detach 页面，保留空闲 WebSocket；列表、详情仍走 HTTP，不增加轮询、登录保活或账号池。

HTTP 失败后冻结数据请求、释放 HTTP 凭据，但不因失败自动关闭或重建 CDP。浏览器意外关闭或 WebSocket 异常则取消 HTTP、释放凭据；恢复必须显式 connect，不承诺 Chrome 重启后免授权。人工授权等待上限 120 秒，单个 CDP 命令及 HTTP 请求仍限 20 秒，取消信号全程生效。

## 后果

活动会话期间保留调试权限，需要明确断开与退出清理。连接复用避免由程序主动重连造成的重复授权，但不能取消 Chrome 自身的授权要求。此变更不解决 BOSS parse_changed 或业务码 37，不据此晋级 supported。
