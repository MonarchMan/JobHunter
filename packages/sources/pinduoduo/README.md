# 拼多多官网来源

- 复核日期：`2026-08-20`
- 入口：<https://careers.pddglobalhr.com/jobs>
- 状态：`experimental`，默认禁用
- 证据：页面可匿名显示 807 个职位，详情链接含稳定 `code`，例如 `/jobs/detail?code=T021366`
- 阻断：前端列表请求显式经过风控封装并生成 `anti_content`；无该值的公开 POST 返回失败
- 允许的降级：受控浏览器正常加载官网，由官网自身脚本发起请求，适配器只读取已渲染职位并操作可见分页。
- 边界：不反向伪造 `anti_content`，不复用 Cookie，不绕过 CAPTCHA；出现验证或不能证明全量时返回 `access_blocked`/`partial`。
- 决策：待通用 BrowserPool 具备受控会话翻页能力后再实现；若首期成本过高则保持 `experimental`，不影响其他来源和 Agent 主链路。
