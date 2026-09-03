import { z } from 'zod';

export const tencentCampusConfigSchema = z
  .object({ pageSize: z.number().int().min(1).max(1000).default(100) })
  .strict();
export type TencentCampusConfig = z.infer<typeof tencentCampusConfigSchema>;

export const tencentCampusListJobSchema = z
  .object({
    postId: z.string().min(1),
    positionTitle: z.string().min(1),
    positionFamily: z.number().int(),
    projectId: z.number().int(),
    projectName: z.string().min(1),
    recruitLabelName: z.string().min(1),
    workCities: z.string().nullable().optional(),
  })
  .loose();

export const tencentCampusListResponseSchema = z
  .object({
    status: z.literal(0),
    data: z.object({
      positionList: z.array(tencentCampusListJobSchema),
      count: z.number().int().nonnegative(),
    }),
  })
  .loose();

export const tencentCampusDetailSchema = z
  .object({
    postId: z.string().min(1),
    title: z.string().min(1),
    tidName: z.string().nullable().optional(),
    desc: z.string().nullable().optional(),
    request: z.string().nullable().optional(),
    topicDetail: z.string().nullable().optional(),
    topicRequirement: z.string().nullable().optional(),
    workCityList: z.array(z.string().min(1)),
    projectName: z.string().min(1),
    recruitLabelName: z.string().min(1),
    internBonus: z.string().nullable().optional(),
  })
  .loose()
  .superRefine((detail, context) => {
    if (!(detail.desc?.trim() || detail.topicDetail?.trim())) {
      context.addIssue({
        code: 'custom',
        path: ['desc'],
        message: 'Tencent detail has neither desc nor topicDetail.',
      });
    }
    if (!(detail.request?.trim() || detail.topicRequirement?.trim())) {
      context.addIssue({
        code: 'custom',
        path: ['request'],
        message: 'Tencent detail has neither request nor topicRequirement.',
      });
    }
  });
export type TencentCampusDetail = z.infer<typeof tencentCampusDetailSchema>;

export const tencentCampusDetailResponseSchema = z
  .object({ status: z.literal(0), data: tencentCampusDetailSchema })
  .loose();
