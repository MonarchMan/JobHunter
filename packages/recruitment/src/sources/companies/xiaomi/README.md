# 小米官网来源

## `xiaomi.intern`

- 入口：`https://hr.xiaomi.com/website/opportunities.html?project=实习`
- 传输：匿名 JSON，`/website/api/agent/searchJobPage`
- 范围：官网实习职位（`type=3`）
- 详情：列表响应内联职责与要求，使用官网返回的岗位详情链接
- 当前状态：`experimental`；固定样本已覆盖分页、稳定 ID、归一化与重复 ID 降级，2026-08-28 直接 HTTP 全量门禁触发官网访问校验，保持默认关闭
