# 首批官网来源支持矩阵

> 发布记录日期：2026-08-22

| 来源         | 支持状态  | 默认启用 | 适配器                     | 当日在线门禁 | 说明                                                                                                                          |
| ------------ | --------- | -------- | -------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| 腾讯社招     | supported | 是       | `tencent.social@1.0.0`     | 通过         | `smoke-20260820-tencent-01`；公开匿名职位 2275，coverage `complete`，全量分页+一条详情规范化，121.91s                         |
| 拼多多实习   | supported | 是       | `pinduoduo.intern@1.0.0`   | 通过         | `smoke-20260822-pinduoduo-01`；实习接口匿名返回 2 条、1 页，coverage `complete`，稳定 ID 和字段归一化通过；社招风控接口不接入 |
| 字节跳动社招 | supported | 是       | `bytedance.social@1.0.0`   | 通过         | 匿名浏览器由官网脚本生成运行时 `_signature`；响应 `count/limit/offset` 分页、稳定 ID、官方详情 URL 和归一化已通过 Smoke       |
| 美团社招     | supported | 是       | `meituan.social@1.0.0`     | 通过         | `smoke-20260821-meituan-01`；匿名 24 页/2349 条全量分页、详情和离线契约通过，默认低频串行                                     |
| 小红书校招   | supported | 是       | `xiaohongshu.campus@1.0.0` | 通过         | 匿名返回 387 条，4 页分页、稳定 ID、字段归一化和在线 Smoke 已通过，默认每页 100 条低频串行                                    |
| 京东校园     | supported | 是       | `jd.campus@1.0.0`          | 通过         | `smoke-20260822-jd-01`；校园接口匿名返回 75 条、1 页，coverage `complete`，稳定 `publishId` 和字段归一化通过                  |
| 阿里巴巴校招 | supported | 是       | `alibaba.campus@1.0.0`     | 通过         | `smoke-20260822-alibaba-01`；匿名浏览器采集 339 条、34 页，coverage `complete`，339 个稳定 ID，字段归一化通过                 |
| 百度校招     | supported | 是       | `baidu.campus@1.0.0`       | 通过         | `smoke-20260822-baidu-01`；匿名表单 JSON 接口采集实习 458、应届 159，共 617 条/31 页，coverage `complete`，稳定 ID 唯一       |
| 得物校招     | supported | 是       | `dewu.campus@1.0.0`        | 通过         | 匿名浏览器由官网脚本生成运行时 `_signature`；校招/实习筛选返回 6 条、1 页，稳定 ID、官方详情 URL 和归一化已通过 Smoke         |
| 华为校招     | supported | 是       | `huawei.campus@1.0.0`      | 通过         | `smoke-20260822-huawei-01`；匿名实习页采集 31 条、4 页，coverage `complete`，31 个稳定 ID，字段归一化通过                     |

`supported`、`enabled` 和运行时 `health_status` 是独立维度。未通过在线门禁的来源不会默认启用；其适配器可注册用于诊断和显式实验运行。

普通 HTTP 无法取得公开数据时，来源可以使用受控浏览器执行官网公开脚本并读取当前匿名会话的渲染结果；不得逆向伪造风控参数、绕过验证码或复用登录 Cookie。浏览器方案不稳定或维护成本过高时保持 `experimental/blocked`，不阻塞其他来源和 Agent 主链路。实验适配器会注册到代码目录，但默认启用仍由支持门禁控制。
