import { resumeSectionIds, type ResumeDocumentContent, type ResumeSectionId } from './model.js';

/** 各章节拥有的空值；删除只清理模板草稿，不触碰在线画像。 */
const emptySections: Readonly<Record<ResumeSectionId, Partial<ResumeDocumentContent>>> = {
  basic: {
    basicInfo: { name: null, phone: null, email: null, location: null, website: null },
    targetRoles: [],
  },
  target: { targetRoles: [] },
  education: { education: [] },
  work: { workExperience: [] },
  projects: { projects: [] },
  works: { works: [] },
  competitions: { competitions: [] },
  certificates: { certificates: [] },
  languages: { languages: [] },
  skills: { professionalSkills: null, professionalSkillBlocks: [] },
  evaluation: { selfEvaluation: null },
};

/** 仅检查真实文本，不将段落类型或锚点名称误判为用户填写的内容。 */
function hasText(value: unknown): boolean {
  if (typeof value === 'string') return Boolean(value.trim());
  if (Array.isArray(value)) return value.some(hasText);
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([key, child]) => key !== 'type' && hasText(child));
  }
  return false;
}

/** 判断删除章节是否会丢失文字；空白已添加章节可以直接移除。 */
export function hasResumeSectionContent(
  content: ResumeDocumentContent,
  section: ResumeSectionId,
): boolean {
  // 1、专业技能的新段落模型优先于兼容文本，避免旧文本造成误判。
  const fields =
    section === 'skills' && content.professionalSkillBlocks
      ? [content.professionalSkillBlocks]
      : Object.keys(emptySections[section]).map(
          (key) => content[key as keyof ResumeDocumentContent],
        );
  // 2、自定义行只统计单元格文字，不统计 afterBlock 锚点。
  return (
    fields.some(hasText) ||
    (content.textRows?.[section]?.some((row) => hasText(row.cells)) ?? false)
  );
}

/** 显式状态优先；旧草稿按已有内容推导，基本信息作为默认纸面入口。 */
export function isResumeSectionAdded(
  content: ResumeDocumentContent,
  section: ResumeSectionId,
): boolean {
  return (
    content.sectionVisibility?.[section] ??
    (section === 'basic' ||
      hasResumeSectionContent(content, section) ||
      Boolean(content.textRows?.[section]?.length))
  );
}

/** 进入编辑器时固定旧草稿的章节状态，随后清空文字不会导致整章消失。 */
export function initializeResumeSections(content: ResumeDocumentContent): ResumeDocumentContent {
  return {
    ...content,
    sectionVisibility: Object.fromEntries(
      resumeSectionIds.map((section) => [section, isResumeSectionAdded(content, section)]),
    ),
  };
}

/** 清空一个章节及其局部排版、隐藏块、分栏行；不改变其它章节。 */
export function removeResumeSection(
  content: ResumeDocumentContent,
  section: ResumeSectionId,
): ResumeDocumentContent {
  // 1、块键使用模型路径，工作经历是唯一与章节 ID 不同的前缀。
  const prefix = section === 'work' ? 'workExperience' : section;
  // 2、清除该章节数据并显式记录未添加，避免恢复旧草稿时又显示空章节。
  return {
    ...content,
    ...emptySections[section],
    sectionVisibility: { ...content.sectionVisibility, [section]: false },
    textRows: Object.fromEntries(
      Object.entries(content.textRows ?? {}).filter(([id]) => id !== section),
    ),
    formatting: Object.fromEntries(
      Object.entries(content.formatting ?? {}).filter(([id]) => id !== section),
    ),
    hiddenBlocks: content.hiddenBlocks?.filter((key) => !key.startsWith(`${prefix}.`)),
  };
}

/** 添加一个空白章节；重复操作幂等，新增后的空状态独立于是否已填写。 */
export function addResumeSection(
  content: ResumeDocumentContent,
  section: ResumeSectionId,
): ResumeDocumentContent {
  // 1、已添加章节不能重复添加；首次新增先清理旧的局部隐藏状态。
  if (isResumeSectionAdded(content, section)) return content;
  const next = removeResumeSection(content, section);
  const blankEntries: Partial<Record<ResumeSectionId, Partial<ResumeDocumentContent>>> = {
    education: {
      education: [{ institution: '', degree: '', field: '', startDate: '', endDate: '' }],
    },
    work: {
      workExperience: [
        { organization: '', title: '', startDate: '', endDate: '', highlights: [''] },
      ],
    },
    projects: { projects: [{ name: '', role: '', startDate: '', endDate: '', highlights: [''] }] },
    works: { works: [{ name: '', description: '', url: '' }] },
    competitions: { competitions: [{ name: '', award: '', date: '' }] },
    certificates: { certificates: [{ name: '', issuer: '', date: '' }] },
    languages: { languages: [{ name: '', proficiency: '' }] },
    skills: { professionalSkillBlocks: [{ type: 'bullet', text: '' }] },
  };
  // 2、结构化章节使用自己的空字段，其它章节由渲染器生成输入块。
  return {
    ...next,
    ...blankEntries[section],
    sectionVisibility: { ...next.sectionVisibility, [section]: true },
  };
}
