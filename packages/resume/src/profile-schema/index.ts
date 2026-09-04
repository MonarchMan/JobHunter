import { parseCandidateProfile, type CandidateProfileData } from '@jobhunter/domain';
import { z } from 'zod';

const text = z.string().trim().min(1);
// 每条证据都保存原文字符区间，后续会在应用边界再次校验范围和非空性。
const evidenceReferenceSchema = z
  .object({
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    summary: text.max(160),
  })
  .strict()
  .refine((value) => value.end > value.start, 'Evidence end must be greater than start.');

/** 为一个事实附加置信度和至少一条可追溯证据。 */
function evidenceFactSchema<T extends z.ZodType>(
  value: T,
): z.ZodObject<{
  value: T;
  confidence: z.ZodNumber;
  evidenceRefs: z.ZodArray<typeof evidenceReferenceSchema>;
}> {
  return z
    .object({
      value,
      confidence: z.number().min(0).max(1),
      evidenceRefs: z.array(evidenceReferenceSchema).min(1),
    })
    .strict();
}

const dated = {
  startDate: text.nullable(),
  endDate: text.nullable(),
  highlights: z.array(evidenceFactSchema(text)),
};

/** 简历画像 Agent 的严格输出 Schema，防止模型返回无法落库的自由文本。 */
export const resumeProfileAgentOutputSchema = z
  .object({
    targetRoles: z.array(evidenceFactSchema(text)),
    education: z.array(
      z
        .object({
          institution: text.nullable(),
          degree: text.nullable(),
          field: text.nullable(),
          ...dated,
          evidenceRefs: z.array(evidenceReferenceSchema).min(1),
        })
        .strict(),
    ),
    workExperience: z.array(
      z
        .object({
          organization: text.nullable(),
          title: text,
          ...dated,
          evidenceRefs: z.array(evidenceReferenceSchema).min(1),
        })
        .strict(),
    ),
    projects: z.array(
      z
        .object({
          name: text,
          role: text.nullable(),
          ...dated,
          evidenceRefs: z.array(evidenceReferenceSchema).min(1),
        })
        .strict(),
    ),
    professionalSkills: z.array(evidenceFactSchema(text)),
    skills: z.array(
      evidenceFactSchema(
        z
          .object({ name: text, level: z.enum(['familiar', 'proficient', 'expert', 'uncertain']) })
          .strict(),
      ),
    ),
    domains: z.array(evidenceFactSchema(text)),
    yearsOfExperience: evidenceFactSchema(z.number().nonnegative()).nullable(),
    managementExperience: evidenceFactSchema(z.boolean()).nullable(),
  })
  .strict();

/** 模块使用的类型约束。 */
export type ResumeProfileAgentOutput = z.infer<typeof resumeProfileAgentOutputSchema>;

/** 递归收集输出中的所有证据引用，供统一范围校验使用。 */
function collectEvidence(value: unknown, result: z.infer<typeof evidenceReferenceSchema>[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectEvidence(item, result);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  const record = value as Readonly<Record<string, unknown>>;
  if (Array.isArray(record.evidenceRefs)) {
    for (const reference of record.evidenceRefs) {
      result.push(evidenceReferenceSchema.parse(reference));
    }
  }
  for (const [key, child] of Object.entries(record)) {
    if (key !== 'evidenceRefs') collectEvidence(child, result);
  }
}

/** 模块使用的类型约束。 */
export function parseResumeProfileAgentOutput(
  input: unknown,
  extractedText: string,
): ResumeProfileAgentOutput {
  // 1、先校验整体结构，再校验所有证据是否确实指向输入文本。
  const output = resumeProfileAgentOutputSchema.parse(input);
  const evidence: z.infer<typeof evidenceReferenceSchema>[] = [];
  collectEvidence(output, evidence);
  // 2、证据区间必须是左闭右开且不能越过清洗后的文本长度。
  for (const reference of evidence) {
    if (reference.end > extractedText.length) {
      throw new TypeError('Resume profile evidence range exceeds extracted text.');
    }
    if (!extractedText.slice(reference.start, reference.end).trim()) {
      throw new TypeError('Resume profile evidence range points to empty text.');
    }
  }
  return output;
}

/** 执行模块的解析、转换、评分或调用辅助逻辑。 */
export type CandidatePreferences = CandidateProfileData['preferences'];

/** 将 Agent 的脱敏证据摘要转换为领域层证据格式。 */
function domainEvidence(
  references: readonly z.infer<typeof evidenceReferenceSchema>[],
): readonly { readonly source: 'resume'; readonly quote: string }[] {
  return references.map((reference) => ({ source: 'resume', quote: reference.summary }));
}

/** 执行模块的解析、转换、评分或调用辅助逻辑。 */
export function toCandidateProfile(
  output: ResumeProfileAgentOutput,
  preferences: CandidatePreferences,
): CandidateProfileData {
  // 1、丢弃模型元数据，只将已验证的事实映射为领域画像，并保留用户偏好。
  return parseCandidateProfile({
    targetRoles: output.targetRoles.map((fact) => fact.value),
    preferences,
    education: output.education.map((item) => ({
      institution: item.institution,
      degree: item.degree,
      field: item.field,
      startDate: item.startDate,
      endDate: item.endDate,
      evidence: domainEvidence(item.evidenceRefs),
    })),
    workExperience: output.workExperience.map((item) => ({
      organization: item.organization,
      title: item.title,
      startDate: item.startDate,
      endDate: item.endDate,
      highlights: item.highlights.map((fact) => fact.value),
      evidence: domainEvidence(item.evidenceRefs),
    })),
    projects: output.projects.map((item) => ({
      name: item.name,
      role: item.role,
      startDate: item.startDate,
      endDate: item.endDate,
      highlights: item.highlights.map((fact) => fact.value),
      evidence: domainEvidence(item.evidenceRefs),
    })),
    professionalSkills:
      output.professionalSkills
        .map((fact) => fact.value)
        .join('\n')
        .trim() || null,
    skills: output.skills.map((fact) => ({
      name: fact.value.name,
      level: fact.value.level,
      evidence: domainEvidence(fact.evidenceRefs),
    })),
    domains: output.domains.map((fact) => fact.value),
    yearsOfExperience: output.yearsOfExperience?.value ?? null,
    managementExperience: output.managementExperience?.value ?? null,
  });
}
