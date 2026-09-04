import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import chiSimData from '@tesseract.js-data/chi_sim';
import engData from '@tesseract.js-data/eng';
import { createWorker, OEM } from 'tesseract.js';
import type { ResumeMediaType } from '../import/media.js';
import { normalizeResumeText } from '../parsers/index.js';

/** 模块数据结构或契约。 */
export interface ResumeOcrResult {
  readonly text: string;
  readonly characterCount: number;
  readonly engineVersion: string;
}

/** 模块数据结构或契约。 */
export interface ResumeOcrOptions {
  readonly minimumNonWhitespaceCharacters?: number;
  readonly maximumExtractedCharacters?: number;
  readonly signal?: AbortSignal;
}

/** 模块数据结构或契约。 */
export interface ResumeOcrEngine {
  recognize(
    bytes: Uint8Array,
    mediaType: Extract<ResumeMediaType, 'image/jpeg' | 'image/png'>,
    options?: ResumeOcrOptions,
  ): Promise<ResumeOcrResult>;
}

/** OCR 质量不足、文本超限或引擎异常时抛出的稳定错误。 */
export class ResumeOcrError extends Error {
  public readonly code: 'low_quality' | 'text_too_large' | 'engine_failed';

  public constructor(code: ResumeOcrError['code'], message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ResumeOcrError';
    this.code = code;
  }
}

const languages = [chiSimData, engData];

/** 在准备语言包、启动引擎和识别前检查取消状态。 */
function ensureNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException('Resume OCR was aborted.', 'AbortError');
}

/** 将内置中英文语言包复制到本地数据目录，并允许并发初始化竞态。 */
async function stageLanguageData(target: string): Promise<void> {
  await mkdir(target, { recursive: true });
  await Promise.all(
    languages.map(async (language) => {
      const fileName = `${language.code}.traineddata.gz`;
      try {
        await copyFile(path.join(language.langPath, fileName), path.join(target, fileName), 1);
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
      }
    }),
  );
}

/** 基于 Tesseract.js 的本地中英文简历 OCR 实现。 */
export class TesseractResumeOcrEngine implements ResumeOcrEngine {
  readonly #dataRoot: string;

  public constructor(input: { readonly dataRoot: string }) {
    this.#dataRoot = path.resolve(input.dataRoot);
  }

  /** 执行模块组件对外暴露的操作。 */
  public async recognize(
    bytes: Uint8Array,
    mediaType: Extract<ResumeMediaType, 'image/jpeg' | 'image/png'>,
    options: ResumeOcrOptions = {},
  ): Promise<ResumeOcrResult> {
    // 1、校验质量阈值和取消状态，避免启动 OCR 后才发现请求不可执行。
    void mediaType;
    const minimum = options.minimumNonWhitespaceCharacters ?? 80;
    const maximum = options.maximumExtractedCharacters ?? 250_000;
    if (!Number.isSafeInteger(minimum) || minimum < 1) {
      throw new TypeError('Minimum OCR text quality threshold is invalid.');
    }
    if (!Number.isSafeInteger(maximum) || maximum < minimum) {
      throw new TypeError('Maximum OCR text size is invalid.');
    }
    ensureNotAborted(options.signal);

    // 2、准备语言数据并创建可被取消的 Tesseract Worker。
    const languageRoot = path.join(this.#dataRoot, 'ocr', 'languages');
    let worker: Awaited<ReturnType<typeof createWorker>> | null = null;
    const abort = (): void => {
      if (worker) void worker.terminate();
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    try {
      await stageLanguageData(languageRoot);
      ensureNotAborted(options.signal);
      worker = await createWorker(
        languages.map((language) => language.code),
        OEM.LSTM_ONLY,
        {
          langPath: languageRoot,
          cachePath: path.join(this.#dataRoot, 'ocr', 'cache'),
          gzip: true,
        },
      );
      ensureNotAborted(options.signal);
      // 3、执行识别、统一文本格式，并在返回前执行大小和可读性门禁。
      const result = await worker.recognize(Buffer.from(bytes));
      ensureNotAborted(options.signal);
      const text = normalizeResumeText(result.data.text);
      const characterCount = text.length;
      if (characterCount > maximum) {
        throw new ResumeOcrError('text_too_large', 'OCR text exceeds the configured limit.');
      }
      if (text.replaceAll(/\s/g, '').length < minimum) {
        throw new ResumeOcrError('low_quality', 'OCR produced too little readable resume text.');
      }
      return { text, characterCount, engineVersion: 'tesseract.js@7-chi_sim+eng' };
    } catch (error) {
      // 4、保留取消和业务质量错误，其余底层异常统一映射为引擎失败。
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      if (options.signal?.aborted) throw new DOMException('Resume OCR was aborted.', 'AbortError');
      if (error instanceof ResumeOcrError) throw error;
      throw new ResumeOcrError('engine_failed', 'Resume OCR engine failed.', { cause: error });
    } finally {
      options.signal?.removeEventListener('abort', abort);
      if (worker) await worker.terminate().catch(() => undefined);
    }
  }
}
