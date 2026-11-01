import type { ResumeMediaType } from '../import/media.js';

/** OCR 识别后的纯文本及质量计数。 */
export interface ResumeOcrResult {
  readonly text: string;
  readonly characterCount: number;
  readonly engineVersion: string;
}

/** OCR 边界限制；调用方负责提供取消信号和文本阈值。 */
export interface ResumeOcrOptions {
  readonly minimumNonWhitespaceCharacters?: number;
  readonly maximumExtractedCharacters?: number;
  readonly signal?: AbortSignal;
}

/** 应用层依赖的 OCR 端口，不包含任何具体引擎或语言包。 */
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
