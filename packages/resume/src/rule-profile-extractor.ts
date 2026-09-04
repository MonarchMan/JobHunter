import { parseCandidateProfile, type CandidateProfileData } from '@jobhunter/domain';
import type { CandidatePreferences } from './profile-schema/index.js';

/** 模块使用的类型约束。 */
type SectionKey =
  | 'targetRoles'
  | 'education'
  | 'workExperience'
  | 'projects'
  | 'professionalSkills'
  | 'selfEvaluation'
  | 'works'
  | 'competitions'
  | 'certificates'
  | 'languages';

/** 模块使用的类型约束。 */
export type ResumeRuleFallbackReason =
  | 'insufficient_sections'
  | 'duplicate_section'
  | 'empty_section'
  | 'unsupported_section'
  | 'ambiguous_entry'
  | 'unstructured_skills'
  | 'no_profile_content';

/** 模块使用的类型约束。 */
export type ResumeRuleExtractionResult =
  | { readonly kind: 'extracted'; readonly profile: CandidateProfileData }
  | { readonly kind: 'fallback'; readonly reason: ResumeRuleFallbackReason };

/** 模块数据结构或契约。 */
interface SourceLine {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/** 模块数据结构或契约。 */
interface Section {
  readonly key: SectionKey;
  readonly lines: readonly SourceLine[];
}

const headingAliases: Readonly<Record<string, SectionKey>> = {
  求职意向: 'targetRoles',
  求职目标: 'targetRoles',
  目标岗位: 'targetRoles',
  教育经历: 'education',
  教育背景: 'education',
  工作经历: 'workExperience',
  实习经历: 'workExperience',
  '工作/实习经历': 'workExperience',
  工作及实习经历: 'workExperience',
  项目经历: 'projects',
  项目经验: 'projects',
  专业技能: 'professionalSkills',
  技能清单: 'professionalSkills',
  个人技能: 'professionalSkills',
  自我评价: 'selfEvaluation',
  个人评价: 'selfEvaluation',
  作品经历: 'works',
  个人作品: 'works',
  竞赛经历: 'competitions',
  获奖经历: 'competitions',
  荣誉奖项: 'competitions',
  证书: 'certificates',
  资格证书: 'certificates',
  语言能力: 'languages',
  语言技能: 'languages',
};

const possibleUnsupportedHeading =
  /^(?:[\p{Script=Han}A-Za-z/]{2,14})(?:经历|经验|背景|技能|评价|作品|证书|奖项|荣誉|语言|意向)$/u;
const bulletPattern = /^(?:[-*•●▪◦]|\d+[.)、])\s*(.+)$/u;
const dateRangePattern =
  /((?:19|20)\d{2}(?:[./-]\d{1,2}|年\d{1,2}月)?)\s*(?:-|–|—|~|至|到)\s*((?:(?:19|20)\d{2}(?:[./-]\d{1,2}|年\d{1,2}月)?)|至今|现在|Present)/iu;
const urlPattern = /https?:\/\/\S+/iu;
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu;
const phonePattern = /(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/u;

/** 将清洗后的简历文本拆为带偏移的非空行，供证据定位和章节识别复用。 */
function sourceLines(text: string): readonly SourceLine[] {
  const result: SourceLine[] = [];
  let offset = 0;
  for (const raw of text.split('\n')) {
    const leading = raw.length - raw.trimStart().length;
    const value = raw.trim();
    if (value) {
      const start = offset + leading;
      result.push({ text: value, start, end: start + value.length });
    }
    offset += raw.length + 1;
  }
  return result;
}

/** 将章节标题归一化为内部章节键。 */
function headingKey(line: SourceLine): SectionKey | null {
  const normalized = line.text.replaceAll(/\s/g, '').replace(/[：:]$/u, '');
  return headingAliases[normalized] ?? null;
}

/** 识别章节边界，并在重复、空章节或未知章节时返回兜底原因。 */
function sectionsFrom(lines: readonly SourceLine[]):
  | {
      readonly kind: 'sections';
      readonly preface: readonly SourceLine[];
      readonly value: readonly Section[];
    }
  | { readonly kind: 'fallback'; readonly reason: ResumeRuleFallbackReason } {
  const headings = lines.flatMap((line, index) => {
    const key = headingKey(line);
    return key ? [{ index, key }] : [];
  });
  if (headings.length < 2) return { kind: 'fallback', reason: 'insufficient_sections' };
  if (new Set(headings.map(({ key }) => key)).size !== headings.length) {
    return { kind: 'fallback', reason: 'duplicate_section' };
  }
  const sections: Section[] = [];
  for (const [position, heading] of headings.entries()) {
    const next = headings[position + 1];
    const sectionLines = lines.slice(heading.index + 1, next?.index ?? lines.length);
    if (sectionLines.length === 0) return { kind: 'fallback', reason: 'empty_section' };
    const unsupported = sectionLines.find(
      (line) => headingKey(line) === null && possibleUnsupportedHeading.test(line.text),
    );
    if (unsupported) {
      return { kind: 'fallback', reason: 'unsupported_section' };
    }
    sections.push({ key: heading.key, lines: sectionLines });
  }
  return { kind: 'sections', preface: lines.slice(0, headings[0]?.index ?? 0), value: sections };
}

/** 截取有限长度的原文行作为领域证据摘要。 */
function quote(line: SourceLine): string {
  return line.text.slice(0, 160);
}

/** 为规则提取结果创建统一的简历来源证据。 */
function evidence(line: SourceLine): CandidateProfileData['workExperience'][number]['evidence'] {
  return [{ source: 'resume', quote: quote(line) }];
}

/** 去掉列表符号，同时修正内容在原文中的字符偏移。 */
function stripBullet(line: SourceLine): SourceLine {
  const match = bulletPattern.exec(line.text);
  if (!match?.[1]) return line;
  const value = match[1].trim();
  const relative = line.text.indexOf(value);
  return { text: value, start: line.start + relative, end: line.start + relative + value.length };
}

/** 从经历标题中拆出字段和起止日期；无法确认格式时返回空值。 */
function splitHeader(line: SourceLine): {
  readonly parts: readonly string[];
  readonly startDate: string;
  readonly endDate: string;
} | null {
  const date = dateRangePattern.exec(line.text);
  if (!date?.[1] || !date[2]) return null;
  const withoutDate = line.text.replace(date[0], '').replaceAll(/^[|｜\s]+|[|｜\s]+$/gu, '');
  const parts = withoutDate
    .split(/\s*[|｜]\s*/u)
    .map((value) => value.trim())
    .filter(Boolean);
  return parts.length > 0 ? { parts, startDate: date[1], endDate: date[2] } : null;
}

/** 解析带日期标题和项目符号描述的工作或项目条目。 */
function parseDatedEntries(
  section: Section,
  kind: 'work' | 'project',
): CandidateProfileData['workExperience'] | CandidateProfileData['projects'] | null {
  const entries: {
    header: SourceLine;
    parsed: NonNullable<ReturnType<typeof splitHeader>>;
    highlights: SourceLine[];
  }[] = [];
  for (const line of section.lines) {
    const bullet = bulletPattern.exec(line.text);
    if (bullet) {
      const current = entries.at(-1);
      if (!current) return null;
      current.highlights.push(stripBullet(line));
      continue;
    }
    const parsed = splitHeader(line);
    const requiredParts = kind === 'work' ? 2 : 1;
    if (!parsed || parsed.parts.length < requiredParts) return null;
    if (entries.at(-1)?.highlights.length === 0) return null;
    entries.push({ header: line, parsed, highlights: [] });
  }
  if (entries.length === 0 || entries.some((entry) => entry.highlights.length === 0)) return null;
  if (kind === 'work') {
    return entries.map(({ header, parsed, highlights }) => ({
      organization: parsed.parts[0] ?? null,
      title: parsed.parts.at(-1) ?? '',
      startDate: parsed.startDate,
      endDate: parsed.endDate,
      highlights: highlights.map(({ text }) => text),
      evidence: evidence(header),
    }));
  }
  return entries.map(({ header, parsed, highlights }) => ({
    name: parsed.parts[0] ?? '',
    role: parsed.parts.length > 1 ? (parsed.parts.at(-1) ?? null) : null,
    startDate: parsed.startDate,
    endDate: parsed.endDate,
    highlights: highlights.map(({ text }) => text),
    evidence: evidence(header),
  }));
}

/** 解析教育章节中的学校、学历、专业和日期字段。 */
function parseEducation(section: Section): CandidateProfileData['education'] | null {
  const result = section.lines.map((line) => {
    const parsed = splitHeader(line);
    if (!parsed || parsed.parts.length < 2) return null;
    return {
      institution: parsed.parts[0] ?? null,
      degree: parsed.parts[1] ?? null,
      field: parsed.parts[2] ?? null,
      startDate: parsed.startDate,
      endDate: parsed.endDate,
      evidence: evidence(line),
    };
  });
  return result.length > 0 && result.every((value) => value !== null) ? result : null;
}

/** 提取章节中的纯文本值并统一去掉列表符号。 */
function plainValues(lines: readonly SourceLine[]): readonly string[] {
  return lines.map((line) => stripBullet(line).text).filter(Boolean);
}

/** 将技能行补齐为可直接投递的完整事实句子。 */
function professionalSkillSentences(lines: readonly SourceLine[]): readonly string[] {
  return plainValues(lines).map((value) => {
    if (/[。！？.!?]$/u.test(value)) return value;
    if (/(?:精通|熟悉|掌握|了解|使用|具备|能够|擅长|负责)/u.test(value)) return `${value}。`;
    const category = /^([^：:]{1,16})[：:](.+)$/u.exec(value);
    if (category?.[1] && category[2]) return `${category[1]}包括${category[2].trim()}。`;
    return `相关技能包括${value}。`;
  });
}

/** 按常见分隔符拆分求职意向，并移除空值。 */
function targetRoles(section: Section): readonly string[] {
  return plainValues(section.lines).flatMap((line) =>
    line
      .split(/\s*[,，、/|｜]\s*/u)
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

/** 根据原文措辞推断保守的技能熟练度。 */
function skillLevel(value: string): CandidateProfileData['skills'][number]['level'] {
  if (value.includes('精通')) return 'expert';
  if (value.includes('熟悉') || value.includes('掌握')) return 'proficient';
  if (value.includes('了解')) return 'familiar';
  return 'uncertain';
}

/** 解析技能名称、熟练度和对应证据；无法解析任何技能时返回空值。 */
function parseSkills(section: Section): CandidateProfileData['skills'] | null {
  const skills = section.lines.flatMap((source) => {
    const line = stripBullet(source);
    const content = line.text.replace(/^[\p{Script=Han}A-Za-z ]{1,12}[：:]/u, '');
    return content
      .split(/\s*[,，、|｜/]\s*/u)
      .map((value) => value.trim())
      .filter((value) => value.length > 0 && value.length <= 40)
      .map((value) => ({
        name: value.replace(/^(?:精通|熟悉|掌握|了解)\s*/u, '').trim(),
        level: skillLevel(value),
        evidence: evidence(line),
      }))
      .filter(({ name }) => name.length > 0);
  });
  return skills.length > 0 ? skills : null;
}

/** 从简历前言中提取联系方式；姓名和地址不由规则猜测。 */
function parseBasicInfo(lines: readonly SourceLine[]): CandidateProfileData['basicInfo'] {
  const text = lines.map((line) => line.text).join('\n');
  return {
    name: null,
    phone: phonePattern.exec(text)?.[0] ?? null,
    email: emailPattern.exec(text)?.[0] ?? null,
    location: null,
    website: urlPattern.exec(text)?.[0] ?? null,
  };
}

/** 执行模块的解析、转换、评分或调用辅助逻辑。 */
export function extractResumeProfileByRules(
  extractedText: string,
  preferences: CandidatePreferences,
): ResumeRuleExtractionResult {
  // 1、先按章节解析；结构不明确时交给 LLM 画像提取器兜底。
  const parsedSections = sectionsFrom(sourceLines(extractedText));
  if (parsedSections.kind === 'fallback') return parsedSections;
  let meaningfulSections = 0;
  const profile = {
    basicInfo: parseBasicInfo(parsedSections.preface),
    targetRoles: [] as string[],
    preferences,
    education: [] as CandidateProfileData['education'],
    workExperience: [] as CandidateProfileData['workExperience'],
    projects: [] as CandidateProfileData['projects'],
    works: [] as CandidateProfileData['works'],
    competitions: [] as CandidateProfileData['competitions'],
    certificates: [] as CandidateProfileData['certificates'],
    languages: [] as CandidateProfileData['languages'],
    professionalSkills: null as string | null,
    selfEvaluation: null as string | null,
    skills: [] as CandidateProfileData['skills'],
    domains: [] as string[],
    yearsOfExperience: null,
    managementExperience: null,
  };

  // 2、按章节顺序填充候选画像；任何关键章节歧义都会整体回退，避免部分画像误导用户。
  for (const section of parsedSections.value) {
    switch (section.key) {
      case 'targetRoles':
        profile.targetRoles = [...targetRoles(section)];
        break;
      case 'education': {
        const value = parseEducation(section);
        if (!value) return { kind: 'fallback', reason: 'ambiguous_entry' };
        profile.education = value;
        break;
      }
      case 'workExperience': {
        const value = parseDatedEntries(section, 'work') as
          CandidateProfileData['workExperience'] | null;
        if (!value) return { kind: 'fallback', reason: 'ambiguous_entry' };
        profile.workExperience = value;
        break;
      }
      case 'projects': {
        const value = parseDatedEntries(section, 'project') as
          CandidateProfileData['projects'] | null;
        if (!value) return { kind: 'fallback', reason: 'ambiguous_entry' };
        profile.projects = value;
        break;
      }
      case 'professionalSkills': {
        const value = parseSkills(section);
        if (!value) return { kind: 'fallback', reason: 'unstructured_skills' };
        profile.skills = value;
        profile.professionalSkills = professionalSkillSentences(section.lines).join('\n');
        break;
      }
      case 'selfEvaluation':
        profile.selfEvaluation = plainValues(section.lines).join('\n');
        break;
      case 'works':
        profile.works = plainValues(section.lines).map((name) => ({
          name: name.replace(urlPattern, '').trim() || name,
          description: null,
          url: urlPattern.exec(name)?.[0] ?? null,
        }));
        break;
      case 'competitions':
        profile.competitions = plainValues(section.lines).map((line) => {
          const [name, award, date] = line.split(/\s*[|｜]\s*/u);
          return { name: name ?? line, award: award ?? null, date: date ?? null };
        });
        break;
      case 'certificates':
        profile.certificates = plainValues(section.lines).map((name) => ({
          name,
          issuer: null,
          date: null,
        }));
        break;
      case 'languages':
        profile.languages = plainValues(section.lines).map((line) => {
          const [name, proficiency] = line.split(/\s*[|｜]\s*/u);
          return { name: name ?? line, proficiency: proficiency ?? null };
        });
        break;
    }
    meaningfulSections += 1;
  }

  // 3、至少有一个有意义章节且通过领域 Schema 后，才返回规则提取结果。
  if (meaningfulSections === 0) return { kind: 'fallback', reason: 'no_profile_content' };
  return { kind: 'extracted', profile: parseCandidateProfile(profile) };
}
