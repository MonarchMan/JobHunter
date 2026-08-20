import { z } from 'zod';

const text = z.string().trim().min(1);

export const jobEvidenceSchema = z
  .object({
    field: z.enum(['title', 'description', 'experienceText', 'educationText']),
    quote: text.max(240),
  })
  .strict();

const evidencedText = z
  .object({ value: text, evidence: z.array(jobEvidenceSchema).min(1) })
  .strict();

export const jobUnderstandingSchema = z
  .object({
    requiredSkills: z.array(evidencedText),
    preferredSkills: z.array(evidencedText),
    minimumYearsExperience: z
      .object({ value: z.number().nonnegative(), evidence: z.array(jobEvidenceSchema).min(1) })
      .strict()
      .nullable(),
    seniority: evidencedText.nullable(),
    domains: z.array(evidencedText),
  })
  .strict();

export type JobUnderstanding = z.infer<typeof jobUnderstandingSchema>;

export function parseJobUnderstanding(input: unknown): JobUnderstanding {
  return jobUnderstandingSchema.parse(input);
}
