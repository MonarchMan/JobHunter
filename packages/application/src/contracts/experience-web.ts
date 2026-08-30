import { interviewExperienceDraftSchema } from '@jobhunter/domain';
import { z } from 'zod';

const onlineQuestionSchema = z
  .object({
    question: z.string().trim().min(1).max(5_000),
    answer: z.string().trim().max(20_000).nullable(),
    reflection: z.string().trim().max(10_000).nullable(),
  })
  .strict();

export const webCreateOnlineExperienceSchema = z
  .object({
    company: z.string().trim().max(200).nullable(),
    role: z.string().trim().max(200).nullable(),
    stage: z.string().trim().max(100).nullable(),
    occurredOn: z.union([z.iso.date(), z.literal('')]).nullable(),
    outcome: z.string().trim().max(100).nullable(),
    difficulty: z.string().trim().max(100).nullable(),
    tags: z.array(z.string().trim().min(1).max(100)).max(30),
    notes: z.string().trim().max(20_000).nullable(),
    questions: z.array(onlineQuestionSchema).min(1).max(100),
  })
  .strict()
  .transform((value) =>
    interviewExperienceDraftSchema.parse({
      ...value,
      occurredOn: value.occurredOn === '' ? null : value.occurredOn,
      sequenceNo: 1,
      questions: value.questions.map((question, index) => ({
        ...question,
        sequenceNo: index + 1,
        questionEvidence: null,
        answerEvidence: null,
      })),
    }),
  );

export const webReplaceExperienceDraftSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    experiences: z.array(interviewExperienceDraftSchema).min(1).max(50),
  })
  .strict();

export const webAcceptExperienceSchema = z
  .object({ expectedRevision: z.number().int().nonnegative() })
  .strict();

export const webDeleteExperienceSchema = z
  .object({ expectedImpactHash: z.string().length(64), confirmation: z.literal('DELETE') })
  .strict();
