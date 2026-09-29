# ADR-0052：网友面经采用三种研究执行模式

- 状态：Accepted
- 日期：2026-09-29

## 背景

既有网友面经包含 Codex 原生搜索和 Worker 采集后交给无网络 Codex 的两条路径。对 Codex、Claude 和配置模型的试验表明，这三类后端的认证、网页能力和结构化输出特性不同，不应强行共用同一种采集方式；同时本机 CLI 不适合作为默认依赖，系统已有的统一模型配置应成为默认路径。

## 决策

1. 当前研究请求只提供三种模式：`configured-model@v1`、`codex-local@v1`、`claude-local@v1`。不保留 `browser-assisted-codex` 兼容键。
2. 配置模型是默认模式。Worker 根据冻结 Brief 确定性采集公开页面，通过质量门槛后关闭浏览器，再把有界 EvidencePack 交给统一配置的模型 API；模型不得自行联网。输出必须通过本次 trace 的来源、问题和答案逐字回溯。
3. Codex CLI 使用原生实时网页搜索自行研究；Claude Code 在 safe mode 下只开放 `WebSearch`、`WebFetch`，使用自动权限模式允许白名单内网页调用，并以空的 strict MCP 配置禁用外部工具。两者都不得获得 Shell、本地文件、项目规则、浏览器控制、未授信 MCP、插件、Skill 或业务数据。
4. 三种模式共享冻结 Prompt/Schema、Bundle 导入、规范化、问题去重、人工审核和任务诊断，但不伪装成相同的证据强度。只有配置模型模式能声明经过 Worker 的逐字 trace 校验；CLI 结果保持 `unverified`，由用户通过原始来源复核。
5. Prompt/Schema 导出与人工 Bundle 导入继续作为不依赖任何自动执行器的恢复路径。

## 结果

- 默认路径只依赖用户已配置的模型，不要求安装或登录本机 CLI。
- Codex 和 Claude 可以发挥各自的联网研究能力，但权限白名单和数据边界保持最小化。
- 删除旧执行器键属于破坏性任务契约变更；本地实验阶段不迁移旧待执行任务。
