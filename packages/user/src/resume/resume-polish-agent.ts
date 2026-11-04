import {
  resumePolishSectionSchema,
  resumePolishAgentInputSchema,
  resumePolishAgentOutputSchema,
  type ResumePolishAgentInput,
  type ResumePolishAgentOutput,
} from '../contracts/resume-polish.js';
export * from '../contracts/resume-polish.js';
import { defineAgent } from '@jobhunter/common/agent';
import { resumePolishPrompt } from './prompts/resume-polish.js';

/** 简历润色 Agent 定义；无工具且不得新增输入中不存在的事实。 */
export const resumePolishAgentDefinition = defineAgent({
  key: resumePolishPrompt.agentKey,
  outputSchemaVersion: resumePolishPrompt.outputSchemaVersion,
  outputSchemaName: 'ResumePolishOutput',
  systemPrompt: resumePolishPrompt.text,
  inputSchema: resumePolishAgentInputSchema,
  outputSchema: resumePolishAgentOutputSchema,
  tools: [],
  limits: {
    timeoutMs: 120_000,
    maxSteps: 2,
    maxInputTokens: 32_000,
    maxOutputTokens: 8_000,
    maxEstimatedCostMicros: 300_000,
  },
});

/** 执行模块的解析、转换、评分或调用辅助逻辑。 */
export function parseResumePolishAgentOutput(
  output: unknown,
  input: ResumePolishAgentInput,
): ResumePolishAgentOutput {
  // 1、校验模型结构，再逐章节确认选择范围和条目数量没有被模型改变。
  const parsed = resumePolishAgentOutputSchema.parse(output);
  for (const section of resumePolishSectionSchema.options) {
    const selected = input.selectedSections.includes(section);
    const source = input[section];
    const result = parsed[section];
    if (!selected && result !== null) {
      throw new TypeError(`Unselected resume section returned content: ${section}`);
    }
    if (selected && (source?.length !== result?.length || source === null)) {
      throw new TypeError(`Resume polish output does not match source section: ${section}`);
    }
  }
  return parsed;
}
