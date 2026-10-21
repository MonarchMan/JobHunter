import {
  jobApplicationStatusSchema,
  recruitmentMailEventTypeSchema,
  recruitmentScheduleFactSchema,
} from '@jobhunter/domain';
import { z } from 'zod';

const isoNullable = z.iso.datetime().nullable();

/** Web 应聘进展响应：公司分组、岗位流程条和多轮面试时间线。 */
export const webApplicationProgressSchema = z
  .object({
    companies: z.array(
      z
        .object({
          key: z.string().min(1),
          companyName: z.string().min(1),
          status: z.enum(['in_progress', 'needs_action', 'offer', 'closed']),
          totalApplications: z.number().int().nonnegative(),
          activeApplications: z.number().int().nonnegative(),
          actionRequiredApplications: z.number().int().nonnegative(),
          latestEventAt: isoNullable,
          applications: z.array(
            z
              .object({
                id: z.string().min(1),
                companyName: z.string().min(1),
                roleTitle: z.string().min(1),
                status: jobApplicationStatusSchema,
                stage: z.enum(['applied', 'assessment', 'interview', 'offer', 'closed']),
                statusEffectiveAt: isoNullable,
                updatedAt: z.iso.datetime(),
                latestEventAt: isoNullable,
                hasActionRequired: z.boolean(),
                rounds: z.array(
                  z
                    .object({
                      key: z.string().min(1),
                      roundNo: z.number().int().positive(),
                      label: z.string().min(1),
                      status: z.enum(['upcoming', 'completed', 'cancelled']),
                      sourceEventId: z.string().min(1),
                      schedule: recruitmentScheduleFactSchema.nullable(),
                    })
                    .strict(),
                ),
                events: z.array(
                  z
                    .object({
                      id: z.string().min(1),
                      eventType: recruitmentMailEventTypeSchema,
                      effectiveAt: z.iso.datetime(),
                      receivedAt: z.iso.datetime(),
                      stageLabel: z.string().min(1).max(320).nullable(),
                      schedule: recruitmentScheduleFactSchema.nullable(),
                      location: z.string().nullable(),
                      meetingUrl: z.url().nullable(),
                      actionUrl: z.url().nullable(),
                      sourceUrl: z.url().nullable(),
                    })
                    .strict(),
                ),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict();
export type WebApplicationProgress = z.infer<typeof webApplicationProgressSchema>;
