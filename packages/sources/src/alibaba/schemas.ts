import { z } from 'zod';

export const alibabaCampusJobSchema = z
  .object({
    id: z.string().min(1),
    positionName: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    workCity: z.string().nullable().optional(),
    workLocations: z.array(z.string().min(1)).nullable().optional(),
    workContent: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    requirement: z.string().nullable().optional(),
    publishTime: z.string().nullable().optional(),
  })
  .loose()
  .refine((value) => value.positionName !== undefined || value.name !== undefined, {
    message: 'Alibaba job record has no title field.',
  })
  .refine(
    (value) =>
      value.workContent !== undefined ||
      value.description !== undefined ||
      value.requirement !== undefined,
    {
      message: 'Alibaba job record has no description field.',
    },
  );

export type AlibabaCampusJob = z.infer<typeof alibabaCampusJobSchema>;
