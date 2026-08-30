import { z } from 'zod';

export const webCreateProjectDossierSchema = z
  .object({
    profileVersionId: z.uuid(),
    projectIndex: z.number().int().nonnegative(),
    expectedProjectHash: z.string().length(64),
  })
  .strict();

export const webSubmitDrillAnswerSchema = z
  .object({
    sessionId: z.uuid(),
    answer: z.string().trim().min(1).max(20_000),
    idempotencyToken: z.string().trim().min(8).max(200),
  })
  .strict();

export const webStartDrillSessionSchema = z
  .object({
    profileKey: z.enum(['resume-only', 'docs-grounded']).default('resume-only'),
    materialFileIds: z.array(z.uuid()).max(8).default([]),
  })
  .strict();

export const webDrillSessionStateSchema = z
  .object({ action: z.enum(['pause', 'resume', 'complete']) })
  .strict();

export const webDeleteProjectDossierSchema = z
  .object({
    expectedImpactHash: z.string().length(64),
    confirmation: z.literal('DELETE'),
  })
  .strict();
