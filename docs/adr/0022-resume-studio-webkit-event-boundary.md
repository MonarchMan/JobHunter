# ADR-0022：简历编辑画布的 WebKit 事件边界

- 状态：Accepted
- 日期：2026-09-08

## 背景

编辑器由父页面为同源 srcdoc 注册事件。WebKit 在未允许脚本的沙箱中还会阻止这些父页面回调，造成按钮、章节同步和保存静默失效；Chromium 测试不能覆盖这个差异。

## 决策

仅受控编辑画布使用 sandbox="allow-same-origin allow-scripts"，并在任何内容之前输出 CSP：default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'。CSP 禁止文档自身脚本及外部资源；父页面已加载的可信事件逻辑继续运行。所有投递字段保持转义，粘贴只接收纯文本。交互模式不输出导出 HTML 的编辑脚本，即使误传 editable 标记。

预览沙箱不放开脚本。HTML 导出和 Worker PDF 的行为不变。未来不得把任意 HTML 或第三方模板接入此同源编辑边界；若引入此能力须重新设计隔离。

## 验证

同时用 Chromium 与 WebKit 验证结构操作、输入、保存恢复及 CSP 对插入脚本、事件属性、外部资源的阻断；实际 Safari 作为最终人工浏览器回归。
