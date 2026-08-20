export type ResumeMediaType =
  | 'application/pdf'
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  | 'text/plain';

export interface ResumeMediaDetection {
  readonly mediaType: ResumeMediaType;
  readonly byteSize: number;
}

export class ResumeMediaError extends Error {
  public readonly code: 'empty_file' | 'file_too_large' | 'unsupported_media_type' | 'invalid_docx';

  public constructor(code: ResumeMediaError['code'], message: string) {
    super(message);
    this.name = 'ResumeMediaError';
    this.code = code;
  }
}

const pdfHeader = new TextEncoder().encode('%PDF-');
const zipLocalHeader = 0x04034b50;
const zipCentralHeader = 0x02014b50;
const zipEndOfCentralDirectory = 0x06054b50;

function startsWith(bytes: Uint8Array, expected: Uint8Array): boolean {
  return expected.every((value, index) => bytes[index] === value);
}

function findEndOfCentralDirectory(bytes: Uint8Array, view: DataView): number {
  const minimum = Math.max(0, bytes.byteLength - 65_557);
  for (let offset = bytes.byteLength - 22; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) === zipEndOfCentralDirectory) return offset;
  }
  return -1;
}

function zipEntryNames(bytes: Uint8Array): ReadonlySet<string> {
  if (bytes.byteLength < 22) return new Set();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== zipLocalHeader) return new Set();
  const end = findEndOfCentralDirectory(bytes, view);
  if (end < 0) return new Set();
  const entryCount = view.getUint16(end + 10, true);
  const centralSize = view.getUint32(end + 12, true);
  const centralOffset = view.getUint32(end + 16, true);
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    return new Set();
  }
  if (centralOffset + centralSize > bytes.byteLength) return new Set();

  const names = new Set<string>();
  let offset = centralOffset;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > bytes.byteLength || view.getUint32(offset, true) !== zipCentralHeader) {
      return new Set();
    }
    const flags = view.getUint16(offset + 8, true);
    if ((flags & 0x1) !== 0) return new Set();
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const nameStart = offset + 46;
    const next = nameStart + nameLength + extraLength + commentLength;
    if (next > bytes.byteLength) return new Set();
    try {
      names.add(decoder.decode(bytes.subarray(nameStart, nameStart + nameLength)));
    } catch {
      return new Set();
    }
    offset = next;
  }
  return names;
}

function isStrictUtf8Text(bytes: Uint8Array): boolean {
  try {
    const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (value.includes('\0')) return false;
    let suspicious = 0;
    for (const character of value) {
      const code = character.codePointAt(0) ?? 0;
      if (code < 32 && character !== '\n' && character !== '\r' && character !== '\t') {
        suspicious += 1;
      }
    }
    return suspicious === 0;
  } catch {
    return false;
  }
}

export function detectResumeMediaType(
  bytes: Uint8Array,
  maximumBytes = 10 * 1024 * 1024,
): ResumeMediaDetection {
  if (bytes.byteLength === 0) throw new ResumeMediaError('empty_file', 'Resume file is empty.');
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new TypeError('Maximum resume byte size must be a positive safe integer.');
  }
  if (bytes.byteLength > maximumBytes) {
    throw new ResumeMediaError('file_too_large', 'Resume file exceeds the configured size limit.');
  }
  if (startsWith(bytes, pdfHeader)) {
    return { mediaType: 'application/pdf', byteSize: bytes.byteLength };
  }
  if (bytes.byteLength >= 4) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(0, true) === zipLocalHeader) {
      const names = zipEntryNames(bytes);
      if (names.has('[Content_Types].xml') && names.has('word/document.xml')) {
        return {
          mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          byteSize: bytes.byteLength,
        };
      }
      throw new ResumeMediaError('invalid_docx', 'ZIP input is not a valid DOCX document.');
    }
  }
  if (isStrictUtf8Text(bytes)) return { mediaType: 'text/plain', byteSize: bytes.byteLength };
  throw new ResumeMediaError(
    'unsupported_media_type',
    'Resume content is not a supported PDF, DOCX or UTF-8 text file.',
  );
}
