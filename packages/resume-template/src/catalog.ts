import { z } from 'zod';
import { resumeSectionIds } from './model.js';

export const resumeTemplateKeySchema = z.enum(['technical-blueprint', 'clean-single-column']);
export type ResumeTemplateKey = z.infer<typeof resumeTemplateKeySchema>;

export const resumeTemplateMetadataSchema = z.object({
  key: resumeTemplateKeySchema,
  version: z.literal(1),
  name: z.string().min(1),
  description: z.string().min(1),
  thumbnailDataUrl: z.string().startsWith('data:image/svg+xml,'),
  sections: z.array(z.enum(resumeSectionIds)),
});
export type ResumeTemplateMetadata = z.infer<typeof resumeTemplateMetadataSchema>;

export const resumeTemplates: readonly ResumeTemplateMetadata[] = [
  {
    key: 'technical-blueprint',
    version: 1,
    name: '技术蓝图',
    description: '清晰蓝色章节线与时间轴，适合技术和项目经历较多的简历。',
    thumbnailDataUrl:
      'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="160" height="220"%3E%3Crect width="160" height="220" fill="white"/%3E%3Cpath d="M18 22h124v30H18z" fill="%23eef4ff" stroke="%23326cff"/%3E%3Cpath d="M18 72h124M18 102h124M18 132h124M18 162h124" stroke="%23326cff"/%3E%3C/svg%3E',
    sections: [...resumeSectionIds],
  },
  {
    key: 'clean-single-column',
    version: 1,
    name: '简洁单栏',
    description: '高密度单栏与细分隔，适合通用投递和内容较长的简历。',
    thumbnailDataUrl:
      'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="160" height="220"%3E%3Crect width="160" height="220" fill="white"/%3E%3Cpath d="M22 30h76M22 45h116M22 72h116M22 98h116M22 124h116M22 150h116M22 176h92" stroke="%2320242c"/%3E%3C/svg%3E',
    sections: [...resumeSectionIds],
  },
];

export function getResumeTemplate(key: string, version = 1): ResumeTemplateMetadata {
  const parsedKey = resumeTemplateKeySchema.parse(key);
  const template = resumeTemplates.find(
    (item) => item.key === parsedKey && item.version === version,
  );
  if (!template) throw new TypeError('简历模板不存在或版本已不可用。');
  return template;
}
