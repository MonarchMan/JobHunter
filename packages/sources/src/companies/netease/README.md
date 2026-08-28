# 网易官网来源

## `netease.intern` / `netease.social`

- 入口：`https://hr.163.com/job-list.html`
- 传输：匿名 JSON，`POST /api/hr163/position/queryPage`
- 范围：底层读取社招与实习混合列表，canonical adapter 按记录级 `workType` 和标题拆成两个独立来源；`netease.mixed` 只作为内部实现
- 详情：列表响应内联职责与要求，生成官网岗位级详情 URL
- 当前状态：`experimental`；固定样本门禁已通过，2026-08-28 直接 HTTP 全量门禁中途触发官网访问校验，保持默认关闭

## 校招逻辑渠道

`netease-campus` 逻辑渠道下分别声明 `netease-campus-internet`、`netease-campus-games` 和 `netease-campus-leihuo` 三个物理官网来源。三者当前均未完成匿名 JSON 协议门禁，保持 blocked、默认关闭且不注册占位 adapter；后续按物理来源独立实现和晋级。
