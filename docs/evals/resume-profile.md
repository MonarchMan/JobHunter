# ResumeProfileAgent 评测基线

> 状态：Prepared
> Agent：`resume-profile@1.0.0`
> Prompt：`2026-08-20.v1`
> Schema：`2026-08-20.v1`

## 数据集

首个黄金样本引用脱敏简历 `docs/resumes/agent简历 - 新.docx`。测试和报告不得复制简历正文；运行时先使用确定性 DOCX 解析器取得文本，再将最小输入交给 Agent。

当前自动化测试已验证：

- DOCX 可确定性提取，包含 Coding Agent、ReAct 和 RAG 等脱敏事实。
- Agent 输出必须通过结构化 Schema 和证据字符范围校验。
- 无效输出只允许修复一次，仍无效时不得创建画像版本。
- AgentRun 只持久化输入哈希与已校验结构化输出，不持久化简历正文或文件路径。

## 启用门禁

本基线只表示离线运行框架与样本格式已就绪，不代表任何付费模型已经通过质量评测。配置真实模型 Provider 后，必须对同一黄金集生成 `var/evals/resume-profile/` 报告，并满足架构文档中的 Schema 有效率、证据可定位率和零臆造门槛，才能将该模型与 Prompt 组合设为活动配置。
