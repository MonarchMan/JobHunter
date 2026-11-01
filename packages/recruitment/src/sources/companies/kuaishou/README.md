# 快手官网来源

对应 SWT-009～012 与 ADR-0023。公司级 protocol/native/adapter 共享协议和归一化，social/intern/campus 目录提供渠道入口；浏览器生命周期只由 Worker 持有。

| 入口   | adapter key            | 物理来源语义                  |
| ------ | ---------------------- | ----------------------------- |
| social | kuaishou.social        | 主站 C001 + socialr           |
| intern | kuaishou.intern        | 主站日常实习 C002，无地点过滤 |
| intern | kuaishou.intern.campus | 校园站当前 intern 项目        |
| campus | kuaishou.campus        | 校园站当前 fulltime 项目      |

四者均 required，独立 ID 空间、同步历史和缺失状态。校园两类项目通过完整项目清单动态发现最新有效年份，缺失/歧义立即失败。禁止将共享协议或单一实习来源成功等同于全部渠道成功。

公开首页初始化官网已加载的固定 webpack 模块，调用原始公开列表、项目和字典 API，不生成/复制签名、不伪造指纹、不读取用户 Cookie、不处理验证码。官网模块漂移时维护 native.ts 的明确协议映射，不能扫描候选模块、猜测方法或自动降级成零数据。

配置仅允许 pageSize（默认 50，1–100）。单次请求 30 秒、采集 300 秒，元数据及分页至少间隔 5 秒；健康检查一页。无浏览器报 access_blocked。职责/要求内联、公开字段白名单、字典解码；updateTime 不作为发布日期。采样和任何分页异常均不得报告 complete。

验证命令与当日边界证据见 [研究台账](../../../../../specs/026-official-source-wave-two/research.md)。默认跳过在线测试；显式设置 JOBHUNTER_ONLINE_SOURCES=1、JOBHUNTER_ONLINE_SOURCE=kuaishou 或单个 adapter key 才执行两页 smoke。
