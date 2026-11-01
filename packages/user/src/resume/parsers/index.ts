import mammoth from 'mammoth';
import type { ResumeMediaType } from '../import/media.js';

/** 模块使用的类型约束。 */
export type ResumeParseStatus = 'parsed' | 'needs_ocr' | 'failed';

/** 模块数据结构或契约。 */
export interface ResumeParseResult {
  readonly status: ResumeParseStatus;
  readonly parser: 'pdfjs' | 'mammoth' | 'utf8' | 'image';
  readonly parserVersion: string;
  readonly text: string | null;
  readonly characterCount: number;
  readonly errorSummary: string | null;
}

/** 模块数据结构或契约。 */
export interface ResumeParseOptions {
  readonly minimumNonWhitespaceCharacters?: number;
  readonly maximumExtractedCharacters?: number;
  readonly signal?: AbortSignal;
}

const parserVersions = {
  pdfjs: 'pdfjs-dist@5',
  mammoth: 'mammoth@1',
  utf8: 'utf8@1',
  image: 'image-needs-ocr@1',
} as const;

/** 统一不同文件解析器的文本格式，并保持字符偏移可预测。 */
export function normalizeResumeText(value: string): string {
  return value
    .replaceAll('\u0000', '')
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .split('\n')
    .map((line) =>
      line
        .replaceAll(/[\t ]+/g, ' ')
        .replaceAll(/(?<=\p{Script=Han})\s+(?=\p{Script=Han})/gu, '')
        .trim(),
    )
    .join('\n')
    .replaceAll(/\n{3,}/g, '\n\n')
    .trim();
}

/** 将规范媒体类型映射到具体文本解析器。 */
function parserFor(mediaType: ResumeMediaType): ResumeParseResult['parser'] {
  if (mediaType === 'application/pdf') return 'pdfjs';
  if (mediaType === 'text/plain') return 'utf8';
  if (mediaType === 'image/jpeg' || mediaType === 'image/png') return 'image';
  return 'mammoth';
}

/** 在耗时解析的边界检查取消请求，避免继续消耗 CPU。 */
function ensureNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException('Resume parsing was aborted.', 'AbortError');
}

/** 逐页提取 PDF 文本，并在页之间检查取消信号。 */
async function parsePdf(bytes: Uint8Array, signal: AbortSignal | undefined): Promise<string> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  ensureNotAborted(signal);
  const task = getDocument({ data: bytes.slice(), useWorkerFetch: false });
  try {
    const document = await task.promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      ensureNotAborted(signal);
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(
        content.items
          .map((item) => ('str' in item && typeof item.str === 'string' ? item.str : ''))
          .filter(Boolean)
          .join(' '),
      );
      page.cleanup();
    }
    return pages.join('\n\n');
  } finally {
    await task.destroy();
  }
}

/** 按媒体类型读取原始文本；图片交由 OCR 任务处理。 */
async function extract(
  bytes: Uint8Array,
  mediaType: ResumeMediaType,
  signal: AbortSignal | undefined,
): Promise<string> {
  ensureNotAborted(signal);
  if (mediaType === 'image/jpeg' || mediaType === 'image/png') return '';
  if (mediaType === 'text/plain') {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  }
  if (mediaType === 'application/pdf') return parsePdf(bytes, signal);
  const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  ensureNotAborted(signal);
  return result.value;
}

/** 执行模块的解析、转换、评分或调用辅助逻辑。 */
export async function parseResumeText(
  bytes: Uint8Array,
  mediaType: ResumeMediaType,
  options: ResumeParseOptions = {},
): Promise<ResumeParseResult> {
  // 1、选择解析器并校验质量阈值。
  const parser = parserFor(mediaType);
  const minimum = options.minimumNonWhitespaceCharacters ?? 80;
  const maximum = options.maximumExtractedCharacters ?? 250_000;
  if (!Number.isSafeInteger(minimum) || minimum < 1) {
    throw new TypeError('Minimum resume text quality threshold is invalid.');
  }
  if (!Number.isSafeInteger(maximum) || maximum < minimum) {
    throw new TypeError('Maximum extracted resume text size is invalid.');
  }

  try {
    // 2、图片不在此处读取二进制内容，统一返回待 OCR 状态。
    if (parser === 'image') {
      return {
        status: 'needs_ocr',
        parser,
        parserVersion: parserVersions.image,
        text: null,
        characterCount: 0,
        errorSummary: 'Resume image requires background OCR.',
      };
    }
    // 3、提取并清洗文本，再执行长度和可读字符数门禁。
    const text = normalizeResumeText(await extract(bytes, mediaType, options.signal));
    const nonWhitespace = text.replaceAll(/\s/g, '').length;
    if (text.length > maximum) {
      return {
        status: 'failed',
        parser,
        parserVersion: parserVersions[parser],
        text: null,
        characterCount: text.length,
        errorSummary: 'Extracted resume text exceeds the configured model-input limit.',
      };
    }
    if (nonWhitespace < minimum) {
      return {
        status: mediaType === 'application/pdf' ? 'needs_ocr' : 'failed',
        parser,
        parserVersion: parserVersions[parser],
        text: null,
        characterCount: text.length,
        errorSummary:
          mediaType === 'application/pdf'
            ? 'PDF contains too little readable text and may require OCR.'
            : 'Resume contains too little readable text.',
      };
    }
    // 4、通过全部门禁后才允许下游创建画像提取任务。
    return {
      status: 'parsed',
      parser,
      parserVersion: parserVersions[parser],
      text,
      characterCount: text.length,
      errorSummary: null,
    };
  } catch (error) {
    // 5、取消错误继续向上抛出，其余解析异常转换为稳定的失败结果。
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    return {
      status: 'failed',
      parser,
      parserVersion: parserVersions[parser],
      text: null,
      characterCount: 0,
      errorSummary: 'Resume text extraction failed.',
    };
  }
}
