import { z } from 'zod';
const text = z.string().trim().min(1).max(1_000);

/** 允许交给润色 Agent 处理的简历章节。 */
export const resumePolishSectionSchema = z.enum(['workExperience', 'projects']);
/** 模块使用的类型约束。 */
export type ResumePolishSection = z.infer<typeof resumePolishSectionSchema>;

const workExperienceInputSchema = z
  .object({
    organization: text.nullable(),
    title: text,
    highlights: z.array(text).max(20),
  })
  .strict();

const projectInputSchema = z
  .object({
    name: text,
    role: text.nullable(),
    highlights: z.array(text).max(20),
  })
  .strict();

/** 润色 Agent 输入，只携带目标岗位和用户选中的经历内容。 */
export const resumePolishAgentInputSchema = z
  .object({
    targetRole: text.max(100),
    selectedSections: z.array(resumePolishSectionSchema).min(1).max(2),
    workExperience: z.array(workExperienceInputSchema).max(50).nullable(),
    projects: z.array(projectInputSchema).max(50).nullable(),
  })
  .strict();

/** 模块使用的类型约束。 */
export type ResumePolishAgentInput = z.infer<typeof resumePolishAgentInputSchema>;

/** 润色 Agent 输出，只允许返回与输入条目逐项对应的描述数组。 */
export const resumePolishAgentOutputSchema = z
  .object({
    workExperience: z.array(z.array(text).max(20)).max(50).nullable(),
    projects: z.array(z.array(text).max(20)).max(50).nullable(),
  })
  .strict();

/** 模块使用的类型约束。 */
export type ResumePolishAgentOutput = z.infer<typeof resumePolishAgentOutputSchema>;
