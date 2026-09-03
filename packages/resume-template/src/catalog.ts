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
    name: '简洁单页',
    description: '图标化章节、浅蓝信息卡与紧凑时间轴，适合技术岗位的一页式投递。',
    thumbnailDataUrl:
      'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="160" height="220"%3E%3Crect width="160" height="220" rx="3" fill="white"/%3E%3Cpath d="M14 14h132v43H14z" fill="%23f7f9fc" stroke="%23111827"/%3E%3Ccircle cx="30" cy="35" r="11" fill="%23dce8ff"/%3E%3Cpath d="M48 27h57M48 37h83M48 47h69" stroke="%23326cff"/%3E%3Cg fill="%23eef4ff" stroke="%23bed0ff"%3E%3Crect x="14" y="73" width="132" height="28" rx="4"/%3E%3Crect x="14" y="164" width="132" height="38" rx="4"/%3E%3C/g%3E%3Cpath d="M23 115v35M28 116h104M28 128h96M28 140h104M28 152h76" stroke="%23326cff"/%3E%3C/svg%3E',
    sections: [...resumeSectionIds],
  },
  {
    key: 'clean-single-column',
    version: 1,
    name: '标准单页',
    description: '标准单栏与细分隔，适合通用岗位的一页式投递。',
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
