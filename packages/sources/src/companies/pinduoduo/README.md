# 拼多多官网来源

- 复核日期：`2026-08-22`
- 入口：<https://careers.pddglobalhr.com/campus/intern>
- 状态：`supported`，默认启用；适配器：`pinduoduo.intern@1.0.0`
- 协议：官网公开实习脚本使用匿名 `POST /api/careers/api/recruit/position/train/list`；请求体使用 `page/pageSize/t`，响应使用 `result.total` 与 `result.list`。
- 门禁证据：`smoke-20260822-pinduoduo-01` 返回 2 条、1 页，coverage `complete`，2 个唯一稳定 ID；职位标题、实习类型、地点、职责和毕业年份已归一化。
- 类别接口：参考脚本中的实习类型接口仅作为入口协议记录，不影响职位列表采集；适配器不保存 Cookie 或短期令牌。
- 边界：拼多多社会招聘接口仍依赖官网风控 `anti_content`，未接入、不伪造；实习接口变化或出现验证时分别返回 `parse_changed`/`access_blocked`。
