import { z } from 'zod';
import { DomainError } from '../shared/domain-error.js';

/** 个人面经解析器版本。 */
export const personalExperienceParserVersion = 'personal-experience-parser@v1' as const;
/** 个人面经模板版本。 */
export const personalExperienceTemplateVersion = 'personal-experience@v1' as const;

/** 个人面经文档审核状态。 */
export const experienceDocumentStatusSchema = z.enum(['draft', 'accepted', 'rejected']);
/** 领域模型的类型约束。 */
export type ExperienceDocumentStatus = z.infer<typeof experienceDocumentStatusSchema>;

/** 个人面经来源模式。 */
export const experienceSourceModeSchema = z.enum(['upload', 'online']);
/** 领域模型的类型约束。 */
export type ExperienceSourceMode = z.infer<typeof experienceSourceModeSchema>;

/** 解析后需要用户补充或确认的面经警告。 */
export const experienceWarningCodeSchema = z.enum([
  'missing_company',
  'missing_role',
  'no_questions',
  'unanswered_questions',
  'unclassified_notes',
]);
/** 领域模型的类型约束。 */
export type ExperienceWarningCode = z.infer<typeof experienceWarningCodeSchema>;

/** 面经问题或回答在规范化原文中的左闭右开字符范围。 */
export const textEvidenceRangeSchema = z
  .object({ start: z.number().int().nonnegative(), end: z.number().int().positive() })
  .strict()
  .refine((value) => value.end > value.start, 'Evidence range must not be empty.');

const optionalText = (maximum: number): z.ZodNullable<z.ZodString> =>
  z.string().trim().min(1).max(maximum).nullable();

/** 单个面试问题及可选回答、复盘和原文证据范围。 */
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
/** 领域模型的类型约束。 */
export type InterviewQuestionDraft = z.infer<typeof interviewQuestionDraftSchema>;

/** 一段面试经历及其问题列表的草稿 Schema。 */
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
/** 领域模型的类型约束。 */
export type InterviewExperienceDraft = z.infer<typeof interviewExperienceDraftSchema>;

/** 个人面经清洗解析结果和待处理警告。 */
export const personalExperienceParseResultSchema = z
  .object({
    normalizedText: z.string().min(1).max(250_000),
    experiences: z.array(interviewExperienceDraftSchema).min(1).max(50),
    warnings: z.array(experienceWarningCodeSchema),
  })
  .strict();
/** 领域模型的类型约束。 */
export type PersonalExperienceParseResult = z.infer<typeof personalExperienceParseResultSchema>;

/** 模块数据结构或契约。 */
interface SourceLine {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/** 模块数据结构或契约。 */
interface MutableQuestion {
  sequenceNo: number;
  question: string;
  answer: string | null;
  reflection: string | null;
  questionEvidence: { start: number; end: number } | null;
  answerEvidence: { start: number; end: number } | null;
}

/** 规范化单行文本，空行转换为 null。 */
function normalizedValue(value: string): string | null {
  const result = value.replaceAll(/[\t ]+/g, ' ').trim();
  return result || null;
}

/** 将文本拆为保留字符偏移的行，供问题和回答证据引用。 */
function sourceLines(value: string): readonly SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;
  for (const text of value.split('\n')) {
    lines.push({ text, start, end: start + text.length });
    start += text.length + 1;
  }
  return lines;
}

/** 清洗个人面经原文，统一换行、去除 BOM 和过量空行。 */
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

/** 计算一段值在原文行中的左闭右开字符范围。 */
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

/** 拆分、去重并限制面经标签数量。 */
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

/** 解析单段面试经历，识别元数据、问题、回答、复盘和备注。 */
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
      switch (key) {
        case '公司':
          company = value;
          break;
        case '岗位':
          role = value;
          break;
        case '面试阶段':
        case '阶段':
          stage = value;
          break;
        case '结果':
          outcome = value;
          break;
        case '难度':
          difficulty = value;
          break;
        case '标签':
          tags = splitTags(value);
          break;
        case '面试日期':
        case '日期':
          if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) occurredOn = value;
          break;
      }
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

/** 执行领域校验、归一化或合并逻辑。 */
export function parsePersonalExperienceText(value: string): PersonalExperienceParseResult {
  // 1、清洗并限制原文规模，再按经历标题切分文本块。
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
  // 2、逐块解析问题和回答，最后统一计算提醒并通过结果 Schema。
  const experiences = blocks.map((block, index) => parseExperience(block, index + 1));
  const warnings = experienceWarnings(experiences);
  return personalExperienceParseResultSchema.parse({ normalizedText, experiences, warnings });
}

/** 根据面经完整性生成可解释的补充提醒。 */
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

/** 接受面经前确认至少存在一个可复用的面试问题。 */
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
