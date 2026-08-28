import { parseCandidateProfile, type CandidateProfileData } from '@jobhunter/domain';
import type { CandidatePreferences } from './profile-schema/index.js';

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

export type ResumeRuleFallbackReason =
  | 'insufficient_sections'
  | 'duplicate_section'
  | 'empty_section'
  | 'unsupported_section'
  | 'ambiguous_entry'
  | 'unstructured_skills'
  | 'no_profile_content';

export type ResumeRuleExtractionResult =
  | { readonly kind: 'extracted'; readonly profile: CandidateProfileData }
  | { readonly kind: 'fallback'; readonly reason: ResumeRuleFallbackReason };

interface SourceLine {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

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

function headingKey(line: SourceLine): SectionKey | null {
  const normalized = line.text.replaceAll(/\s/g, '').replace(/[：:]$/u, '');
  return headingAliases[normalized] ?? null;
}

function sectionsFrom(
  lines: readonly SourceLine[],
):
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

function quote(line: SourceLine): string {
  return line.text.slice(0, 160);
}

function evidence(line: SourceLine): CandidateProfileData['workExperience'][number]['evidence'] {
  return [{ source: 'resume', quote: quote(line) }];
}

function stripBullet(line: SourceLine): SourceLine {
  const match = bulletPattern.exec(line.text);
  if (!match?.[1]) return line;
  const value = match[1].trim();
  const relative = line.text.indexOf(value);
  return { text: value, start: line.start + relative, end: line.start + relative + value.length };
}

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

function plainValues(lines: readonly SourceLine[]): readonly string[] {
  return lines.map((line) => stripBullet(line).text).filter(Boolean);
}

function targetRoles(section: Section): readonly string[] {
  return plainValues(section.lines).flatMap((line) =>
    line
      .split(/\s*[,，、/|｜]\s*/u)
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function skillLevel(value: string): CandidateProfileData['skills'][number]['level'] {
  if (value.includes('精通')) return 'expert';
  if (value.includes('熟悉') || value.includes('掌握')) return 'proficient';
  if (value.includes('了解')) return 'familiar';
  return 'uncertain';
}

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

export function extractResumeProfileByRules(
  extractedText: string,
  preferences: CandidatePreferences,
): ResumeRuleExtractionResult {
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

  for (const section of parsedSections.value) {
    if (section.key === 'targetRoles') profile.targetRoles = [...targetRoles(section)];
    else if (section.key === 'education') {
      const value = parseEducation(section);
      if (!value) return { kind: 'fallback', reason: 'ambiguous_entry' };
      profile.education = value;
    } else if (section.key === 'workExperience') {
      const value = parseDatedEntries(section, 'work') as
        CandidateProfileData['workExperience'] | null;
      if (!value) return { kind: 'fallback', reason: 'ambiguous_entry' };
      profile.workExperience = value;
    } else if (section.key === 'projects') {
      const value = parseDatedEntries(section, 'project') as
        CandidateProfileData['projects'] | null;
      if (!value) return { kind: 'fallback', reason: 'ambiguous_entry' };
      profile.projects = value;
    } else if (section.key === 'professionalSkills') {
      const value = parseSkills(section);
      if (!value) return { kind: 'fallback', reason: 'unstructured_skills' };
      profile.skills = value;
      profile.professionalSkills = plainValues(section.lines).join('\n');
    } else if (section.key === 'selfEvaluation') {
      profile.selfEvaluation = plainValues(section.lines).join('\n');
    } else if (section.key === 'works') {
      profile.works = plainValues(section.lines).map((name) => ({
        name: name.replace(urlPattern, '').trim() || name,
        description: null,
        url: urlPattern.exec(name)?.[0] ?? null,
      }));
    } else if (section.key === 'competitions') {
      profile.competitions = plainValues(section.lines).map((line) => {
        const [name, award, date] = line.split(/\s*[|｜]\s*/u);
        return { name: name ?? line, award: award ?? null, date: date ?? null };
      });
    } else if (section.key === 'certificates') {
      profile.certificates = plainValues(section.lines).map((name) => ({
        name,
        issuer: null,
        date: null,
      }));
    } else {
      profile.languages = plainValues(section.lines).map((line) => {
        const [name, proficiency] = line.split(/\s*[|｜]\s*/u);
        return { name: name ?? line, proficiency: proficiency ?? null };
      });
    }
    meaningfulSections += 1;
  }

  if (meaningfulSections === 0) return { kind: 'fallback', reason: 'no_profile_content' };
  return { kind: 'extracted', profile: parseCandidateProfile(profile) };
}
