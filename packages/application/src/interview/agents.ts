import { defineAgent } from '@jobhunter/agent-core';
import {
  answerDigestOutputSchema,
  drillCoverageDimensionSchema,
  drillCoverageStatusSchema,
  drillEvidenceRefSchema,
  generatedProjectQuestionSchema,
  projectKnowledgeKindSchema,
} from '@jobhunter/domain';
import { z } from 'zod';

const projectSchema = z
  .object({
    name: z.string().min(1),
    role: z.string().nullable(),
    startDate: z.string().nullable(),
    endDate: z.string().nullable(),
    highlights: z.array(z.string()),
  })
  .strict();

const coverageSchema = z
  .object({
    dimension: drillCoverageDimensionSchema,
    status: drillCoverageStatusSchema,
  })
  .strict();

export const projectQuestionAgentInputSchema = z
  .object({
    project: projectSchema,
    history: z
      .array(
        z
          .object({
            question: z.string().min(1).max(600),
            answer: z.string().min(1).max(20_000),
          })
          .strict(),
      )
      .max(30),
    knowledgeItems: z
      .array(
        z
          .object({
            kind: projectKnowledgeKindSchema,
            statement: z.string().min(1).max(600),
          })
          .strict(),
      )
      .max(100),
    coverage: z.array(coverageSchema).max(10),
    allowedEvidenceRefs: z.array(drillEvidenceRefSchema).min(1).max(150),
  })
  .strict();

export const projectAnswerDigestAgentInputSchema = z
  .object({
    project: projectSchema,
    question: z.string().min(1).max(600),
    answer: z.string().min(1).max(20_000),
    coverage: z.array(coverageSchema).max(10),
  })
  .strict();

const limits = {
  timeoutMs: 90_000,
  maxSteps: 2,
  maxInputTokens: 18_000,
  maxOutputTokens: 2_000,
  maxEstimatedCostMicros: 250_000,
} as const;

export const projectQuestionAgentDefinition = defineAgent({
  key: 'interview.project-question',
  version: 'v1',
  promptVersion: 'v1',
  outputSchemaVersion: 'v1',
  outputSchemaName: 'project_interview_question',
  systemPrompt: `你是严格但克制的技术面试官，只负责提出一个项目追问和回答结构提示。
只能使用输入中的简历项目、用户回答和派生知识项，不得补写项目事实。
不得提供第一人称答案、完整示范答案或可直接照读的内容。
不得要求读取项目目录、源码、Git、Shell、文件系统或网络。
evidenceRefs 必须逐字选自 allowedEvidenceRefs。guidanceSlots 只写回答应覆盖的槽位名称。`,
  inputSchema: projectQuestionAgentInputSchema,
  outputSchema: generatedProjectQuestionSchema,
  tools: [],
  limits,
});

export const projectAnswerDigestAgentDefinition = defineAgent({
  key: 'interview.project-answer-digest',
  version: 'v1',
  promptVersion: 'v1',
  outputSchemaVersion: 'v1',
  outputSchemaName: 'project_answer_digest',
  systemPrompt: `你只从用户回答原文中抽取项目知识项、歧义、冲突和覆盖变化。
不得润色、代答、补充常识或把推断写成用户事实。
每个知识项必须给出回答原文中的精确 quote、JavaScript 字符串 start/end 偏移。
coverageUpdates 只能引用本次 knowledgeItems 的下标；证据不足时使用 evidence_partial 或 needs_clarification。`,
  inputSchema: projectAnswerDigestAgentInputSchema,
  outputSchema: answerDigestOutputSchema,
  tools: [],
  limits,
});
