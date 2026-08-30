import { z } from 'zod';
import { DomainError } from '../shared/domain-error.js';

export const personalExperienceParserVersion = 'personal-experience-parser@v1' as const;
export const personalExperienceTemplateVersion = 'personal-experience@v1' as const;

export const experienceDocumentStatusSchema = z.enum(['draft', 'accepted', 'rejected']);
export type ExperienceDocumentStatus = z.infer<typeof experienceDocumentStatusSchema>;

export const experienceSourceModeSchema = z.enum(['upload', 'online']);
export type ExperienceSourceMode = z.infer<typeof experienceSourceModeSchema>;

export const experienceWarningCodeSchema = z.enum([
  'missing_company',
  'missing_role',
  'no_questions',
  'unanswered_questions',
  'unclassified_notes',
]);
export type ExperienceWarningCode = z.infer<typeof experienceWarningCodeSchema>;

export const textEvidenceRangeSchema = z
  .object({ start: z.number().int().nonnegative(), end: z.number().int().positive() })
  .strict()
  .refine((value) => value.end > value.start, 'Evidence range must not be empty.');

const optionalText = (maximum: number): z.ZodNullable<z.ZodString> =>
  z.string().trim().min(1).max(maximum).nullable();

export const interviewQuestionDraftSchema = z
  .object({
    sequenceNo: z.number().int().positive(),
    question: z.string().trim().min(1).max(5_000),
    answer: optionalText(20_000),
    reflection: optionalText(10_000),
    questionEvidence: textEvidenceRangeSchema.nullable(),
    answerEvidence: textEvidenceRangeSchema.nullable(),
  })
  .strict();
export type InterviewQuestionDraft = z.infer<typeof interviewQuestionDraftSchema>;

export const interviewExperienceDraftSchema = z
  .object({
    sequenceNo: z.number().int().positive(),
    company: optionalText(200),
    role: optionalText(200),
    stage: optionalText(100),
    occurredOn: z.iso.date().nullable(),
    outcome: optionalText(100),
    difficulty: optionalText(100),
    tags: z.array(z.string().trim().min(1).max(100)).max(30),
    notes: optionalText(20_000),
    questions: z.array(interviewQuestionDraftSchema).max(100),
  })
  .strict();
export type InterviewExperienceDraft = z.infer<typeof interviewExperienceDraftSchema>;

export const personalExperienceParseResultSchema = z
  .object({
    normalizedText: z.string().min(1).max(250_000),
    experiences: z.array(interviewExperienceDraftSchema).min(1).max(50),
    warnings: z.array(experienceWarningCodeSchema),
  })
  .strict();
export type PersonalExperienceParseResult = z.infer<typeof personalExperienceParseResultSchema>;

interface SourceLine {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

interface MutableQuestion {
  sequenceNo: number;
  question: string;
  answer: string | null;
  reflection: string | null;
  questionEvidence: { start: number; end: number } | null;
  answerEvidence: { start: number; end: number } | null;
}

function normalizedValue(value: string): string | null {
  const result = value.replaceAll(/[\t ]+/g, ' ').trim();
  return result || null;
}

function sourceLines(value: string): readonly SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;
  for (const text of value.split('\n')) {
    lines.push({ text, start, end: start + text.length });
    start += text.length + 1;
  }
  return lines;
}

export function cleanPersonalExperienceText(value: string): string {
  return value
    .replaceAll('\u0000', '')
    .replace(/^\uFEFF/, '')
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .split('\n')
    .map((line) => line.replaceAll(/[\t ]+$/g, ''))
    .join('\n')
    .replaceAll(/\n{4,}/g, '\n\n\n')
    .trim();
}

function valueRange(line: SourceLine, value: string): { start: number; end: number } | null {
  if (!value.trim()) return null;
  const offset = line.text.indexOf(value);
  if (offset < 0) return null;
  const leading = value.length - value.trimStart().length;
  const trimmed = value.trim();
  return {
    start: line.start + offset + leading,
    end: line.start + offset + leading + trimmed.length,
  };
}

function splitTags(value: string | null): readonly string[] {
  if (!value) return [];
  return [
    ...new Set(
      value
        .split(/[,，、]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ].slice(0, 30);
}

function parseExperience(
  lines: readonly SourceLine[],
  sequenceNo: number,
): InterviewExperienceDraft {
  let company: string | null = null;
  let role: string | null = null;
  let stage: string | null = null;
  let occurredOn: string | null = null;
  let outcome: string | null = null;
  let difficulty: string | null = null;
  let tags: readonly string[] = [];
  const notes: string[] = [];
  const questions: MutableQuestion[] = [];
  let current: MutableQuestion | null = null;
  let currentField: 'question' | 'answer' | 'reflection' | null = null;
  let noteSection = false;

  for (const line of lines) {
    const trimmed = line.text.trim();
    if (!trimmed) {
      currentField = null;
      continue;
    }
    const normalized = trimmed;
    if (/^#{1,6}\s/.test(normalized)) {
      noteSection = /^#{1,6}\s*(?:过程与备注|备注|复盘备注)/.test(normalized);
      currentField = null;
      continue;
    }
    if (/^>\s*(?:模板版本|使用说明)/.test(normalized)) continue;

    const metadata =
      /^(?:[-*]\s*)?(公司|岗位|面试阶段|阶段|面试日期|日期|结果|难度|标签)\s*[：:]\s*(.*)$/.exec(
        normalized,
      );
    if (metadata) {
      const key = metadata[1];
      const value = normalizedValue(metadata[2] ?? '');
      if (key === '公司') company = value;
      else if (key === '岗位') role = value;
      else if (key === '面试阶段' || key === '阶段') stage = value;
      else if (key === '结果') outcome = value;
      else if (key === '难度') difficulty = value;
      else if (key === '标签') tags = splitTags(value);
      else if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) occurredOn = value;
      currentField = null;
      continue;
    }

    const questionMatch = /^(?:[-*]\s*)?(?:问题|问|Q)\s*\d*\s*[：:.、-]\s*(.+)$/i.exec(normalized);
    const numberedQuestion = /^\d+[.、]\s*(.+[?？])$/.exec(normalized);
    if (questionMatch || numberedQuestion) {
      const raw = questionMatch?.[1] ?? numberedQuestion?.[1] ?? '';
      const question = normalizedValue(raw);
      if (!question) continue;
      current = {
        sequenceNo: questions.length + 1,
        question,
        answer: null,
        reflection: null,
        questionEvidence: valueRange(line, raw),
        answerEvidence: null,
      };
      questions.push(current);
      currentField = 'question';
      noteSection = false;
      continue;
    }

    const answerMatch = /^(?:[-*]\s*)?(?:回答|答|A)\s*\d*\s*[：:.、-]\s*(.*)$/i.exec(normalized);
    if (answerMatch) {
      const raw = answerMatch[1] ?? '';
      if (!current) {
        notes.push(trimmed);
        currentField = null;
        continue;
      }
      current.answer = normalizedValue(raw);
      current.answerEvidence = valueRange(line, raw);
      currentField = 'answer';
      continue;
    }

    const reflectionMatch = /^(?:[-*]\s*)?复盘\s*[：:]\s*(.*)$/.exec(normalized);
    if (reflectionMatch) {
      const value = normalizedValue(reflectionMatch[1] ?? '');
      if (current) current.reflection = value;
      else if (value) notes.push(value);
      currentField = current ? 'reflection' : null;
      continue;
    }

    if (current && currentField) {
      const value = normalizedValue(trimmed);
      if (!value) continue;
      if (currentField === 'question') {
        current.question = `${current.question}\n${value}`;
        current.questionEvidence = current.questionEvidence
          ? { ...current.questionEvidence, end: line.end }
          : { start: line.start, end: line.end };
      }
      if (currentField === 'answer') {
        current.answer = current.answer ? `${current.answer}\n${value}` : value;
        current.answerEvidence = current.answerEvidence
          ? { ...current.answerEvidence, end: line.end }
          : { start: line.start, end: line.end };
      }
      if (currentField === 'reflection') {
        current.reflection = current.reflection ? `${current.reflection}\n${value}` : value;
      }
      continue;
    }

    if (noteSection || !/^[-*]\s*$/.test(trimmed)) notes.push(trimmed);
  }

  return interviewExperienceDraftSchema.parse({
    sequenceNo,
    company,
    role,
    stage,
    occurredOn,
    outcome,
    difficulty,
    tags,
    notes: normalizedValue(notes.join('\n')),
    questions,
  });
}

export function parsePersonalExperienceText(value: string): PersonalExperienceParseResult {
  const normalizedText = cleanPersonalExperienceText(value);
  if (!normalizedText)
    throw new DomainError('INVALID_EXPERIENCE_TEXT', 'Experience text is empty.');
  if (normalizedText.length > 250_000) {
    throw new DomainError('INVALID_EXPERIENCE_TEXT', 'Experience text is too large.');
  }
  const lines = sourceLines(normalizedText);
  const boundaries = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) =>
      /^#{1,3}\s*(?:面试)?经历\s*\d*\s*$/.test(line.text.trim().normalize('NFKC')),
    )
    .map(({ index }) => index);
  const blocks: (readonly SourceLine[])[] = [];
  if (boundaries.length === 0) blocks.push(lines);
  else {
    boundaries.forEach((start, index) => {
      const end = boundaries[index + 1] ?? lines.length;
      blocks.push(lines.slice(start + 1, end));
    });
  }
  const experiences = blocks.map((block, index) => parseExperience(block, index + 1));
  const warnings = experienceWarnings(experiences);
  return personalExperienceParseResultSchema.parse({ normalizedText, experiences, warnings });
}

export function experienceWarnings(
  experiences: readonly InterviewExperienceDraft[],
): readonly ExperienceWarningCode[] {
  const warnings = new Set<ExperienceWarningCode>();
  if (experiences.some((item) => item.company === null)) warnings.add('missing_company');
  if (experiences.some((item) => item.role === null)) warnings.add('missing_role');
  if (experiences.every((item) => item.questions.length === 0)) warnings.add('no_questions');
  if (experiences.some((item) => item.questions.some((question) => question.answer === null))) {
    warnings.add('unanswered_questions');
  }
  if (experiences.some((item) => item.notes !== null)) warnings.add('unclassified_notes');
  return [...warnings];
}

export function assertExperienceDraftCanBeAccepted(
  experiences: readonly InterviewExperienceDraft[],
): void {
  if (!experiences.some((experience) => experience.questions.length > 0)) {
    throw new DomainError(
      'EXPERIENCE_HAS_NO_QUESTIONS',
      'At least one interview question is required.',
    );
  }
}
