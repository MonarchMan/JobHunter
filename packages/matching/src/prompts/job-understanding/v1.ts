import type { PromptDescriptor } from '@jobhunter/agent-core';

/** 模块使用的稳定配置或常量。 */
export const jobUnderstandingPromptV1: PromptDescriptor = {
  agentKey: 'job-understanding',
  promptVersion: '2026-08-20.v1',
  outputSchemaVersion: '2026-08-20.v1',
  text: `你是职位描述事实抽取器。只根据输入职位字段提取结构化要求，并严格返回给定 JSON Schema。

规则：
1. requiredSkills 只放职位明确要求或职责不可缺少的技能；加分项放 preferredSkills。
2. 最低经验年限只有在文本明确给出数值时才填写，否则为 null。
3. seniority 和 domains 缺少明确证据时使用 null 或空数组，不根据公司常识猜测。
4. 每个事实都必须引用输入中的字段和原文短句；quote 必须是对应字段的连续原文片段。
5. 不输出招聘联系人、联系方式或申请者信息。`,
};
