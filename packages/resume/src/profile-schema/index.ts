import { parseCandidateProfile, type CandidateProfileData } from '@jobhunter/domain';
import { z } from 'zod';

const text = z.string().trim().min(1);
const evidenceReferenceSchema = z
  .object({
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    summary: text.max(160),
  })
  .strict()
  .refine((value) => value.end > value.start, 'Evidence end must be greater than start.');

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

export type ResumeProfileAgentOutput = z.infer<typeof resumeProfileAgentOutputSchema>;

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

export function parseResumeProfileAgentOutput(
  input: unknown,
  extractedText: string,
): ResumeProfileAgentOutput {
  const output = resumeProfileAgentOutputSchema.parse(input);
  const evidence: z.infer<typeof evidenceReferenceSchema>[] = [];
  collectEvidence(output, evidence);
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

export type CandidatePreferences = CandidateProfileData['preferences'];

function domainEvidence(
  references: readonly z.infer<typeof evidenceReferenceSchema>[],
): readonly { readonly source: 'resume'; readonly quote: string }[] {
  return references.map((reference) => ({ source: 'resume', quote: reference.summary }));
}

export function toCandidateProfile(
  output: ResumeProfileAgentOutput,
  preferences: CandidatePreferences,
): CandidateProfileData {
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
