# 京东官网来源

- 复核日期：`2026-08-22`
- 入口：<https://campus.jd.com/home>
- 状态：`supported`，默认启用；适配器：`jd.campus@1.0.0`
- 协议：官网公开脚本使用匿名 `POST /api/wx/position/page?type=present`；请求体使用 `pageSize/pageIndex/parameter`，其中校招计划为 `planIdList: ["45"]`。
- 响应：`body.totalNumber` 与 `body.items`；稳定 ID 为 `publishId`。职责与要求内联在 `workContent`、`qualification`，没有依赖独立详情接口。
- 门禁证据：`smoke-20260822-jd-01` 返回 75 条、1 页，coverage `complete`，75 个唯一 `publishId`；岗位标题、部门、方向、地点、职责和要求已归一化。
- URL：适配器使用官方校园入口作为职位详情/申请入口；投递动作仍需用户在官网完成。
- 边界：接口变化时返回 `parse_changed`；出现登录、验证码或访问验证时返回 `access_blocked`，不复用脚本中的 Cookie。
