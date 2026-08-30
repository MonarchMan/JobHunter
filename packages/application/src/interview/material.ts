import {
  contentHash,
  parseContentHash,
  parseId,
  type IdGenerator,
  type ProjectDossierId,
} from '@jobhunter/domain';
import { createHash } from 'node:crypto';
import type { ArtifactStore } from '../ports/artifact-store.js';
import type {
  InterviewProjectRepository,
  ProjectMaterialChunkRecord,
  ProjectMaterialRecord,
} from '../ports/interview-projects.js';

export const projectMaterialParserVersion = 'project-material-markdown@v1' as const;
const maximumBytes = 512 * 1024;
const maximumChunkCharacters = 3_000;
const maximumChunks = 200;

export class ProjectMaterialError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ProjectMaterialError';
  }
}

function safeFileName(value: string): string {
  const result = value.replaceAll('\\', '/').split('/').at(-1)?.trim() ?? '';
  if (!result || result.length > 255 || !/\.(?:md|mdx)$/iu.test(result)) {
    throw new ProjectMaterialError('项目资料仅支持文件名有效的 Markdown 或 MDX 文件。');
  }
  return result;
}

function trimRange(
  text: string,
  start: number,
  end: number,
): { start: number; end: number } | null {
  while (start < end && /\s/u.test(text[start] ?? '')) start += 1;
  while (end > start && /\s/u.test(text[end - 1] ?? '')) end -= 1;
  return start === end ? null : { start, end };
}

function splitRange(
  text: string,
  start: number,
  end: number,
): readonly { readonly start: number; readonly end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  let cursor = start;
  while (cursor < end) {
    let boundary = Math.min(cursor + maximumChunkCharacters, end);
    if (boundary < end) {
      const paragraph = text.lastIndexOf('\n\n', boundary);
      const line = text.lastIndexOf('\n', boundary);
      const candidate = Math.max(
        paragraph >= cursor + 300 ? paragraph + 2 : -1,
        line >= cursor + 300 ? line + 1 : -1,
      );
      if (candidate > cursor) boundary = candidate;
    }
    const trimmed = trimRange(text, cursor, boundary);
    if (trimmed) ranges.push(trimmed);
    cursor = boundary;
  }
  return ranges;
}

export function parseProjectMaterial(
  bytes: Uint8Array,
  ids: IdGenerator,
): { readonly normalizedText: string; readonly chunks: readonly ProjectMaterialChunkRecord[] } {
  if (bytes.byteLength === 0 || bytes.byteLength > maximumBytes) {
    throw new ProjectMaterialError('项目资料必须非空且不超过 512 KiB。');
  }
  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new ProjectMaterialError('项目资料必须使用 UTF-8 编码。');
  }
  if (decoded.includes('\u0000')) throw new ProjectMaterialError('项目资料包含无效的 NUL 字符。');
  const normalizedText = decoded
    .replace(/^\uFEFF/u, '')
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .split('\n')
    .map((line) => line.replaceAll(/[\t ]+$/gu, ''))
    .join('\n')
    .trim();
  if (!normalizedText) throw new ProjectMaterialError('项目资料没有可读取的正文。');

  const headings: { start: number; contentStart: number; level: number; title: string }[] = [];
  let lineStart = 0;
  for (const line of normalizedText.split('\n')) {
    const match = /^(#{1,6})\s+(.+?)\s*$/u.exec(line);
    if (match) {
      const title = match[2]?.trim() ?? '';
      if (title.length > 500) {
        throw new ProjectMaterialError('项目资料的 Markdown 标题不得超过 500 个字符。');
      }
      headings.push({
        start: lineStart,
        contentStart: Math.min(lineStart + line.length + 1, normalizedText.length),
        level: match[1]?.length ?? 1,
        title,
      });
    }
    lineStart += line.length + 1;
  }

  const sections: { start: number; end: number; heading: string | null }[] = [];
  const headingPath: string[] = [];
  if (headings[0]?.start !== 0) {
    sections.push({ start: 0, end: headings[0]?.start ?? normalizedText.length, heading: null });
  }
  headings.forEach((heading, index) => {
    headingPath.splice(heading.level - 1);
    headingPath[heading.level - 1] = heading.title;
    const resolvedHeading = headingPath.filter(Boolean).join(' › ') || heading.title;
    if (resolvedHeading.length > 500) {
      throw new ProjectMaterialError('项目资料的 Markdown 标题路径不得超过 500 个字符。');
    }
    sections.push({
      start: heading.contentStart,
      end: headings[index + 1]?.start ?? normalizedText.length,
      heading: resolvedHeading,
    });
  });

  const chunks = sections.flatMap((section) =>
    splitRange(normalizedText, section.start, section.end).map((range) => ({
      id: parseId(ids.generate(), 'ProjectMaterialChunk'),
      heading: section.heading,
      start: range.start,
      end: range.end,
      contentHash: contentHash(normalizedText.slice(range.start, range.end)),
    })),
  );
  if (chunks.length === 0) {
    const range = trimRange(normalizedText, 0, normalizedText.length);
    if (!range) throw new ProjectMaterialError('项目资料没有可读取的正文。');
    chunks.push({
      id: parseId(ids.generate(), 'ProjectMaterialChunk'),
      heading: null,
      ...range,
      contentHash: contentHash(normalizedText.slice(range.start, range.end)),
    });
  }
  if (chunks.length > maximumChunks) {
    throw new ProjectMaterialError('项目资料分块超过 200 个，请拆分或精简文档。');
  }
  return { normalizedText, chunks };
}

export class ProjectMaterialService {
  readonly #repository: InterviewProjectRepository;
  readonly #artifacts: ArtifactStore;
  readonly #ids: IdGenerator;

  public constructor(input: {
    readonly repository: InterviewProjectRepository;
    readonly artifacts: ArtifactStore;
    readonly ids: IdGenerator;
  }) {
    this.#repository = input.repository;
    this.#artifacts = input.artifacts;
    this.#ids = input.ids;
  }

  public async import(input: {
    readonly dossierId: ProjectDossierId;
    readonly fileName: string;
    readonly bytes: Uint8Array;
    readonly createdAt: ProjectMaterialRecord['createdAt'];
    readonly signal: AbortSignal;
  }): Promise<{ readonly material: ProjectMaterialRecord; readonly deduplicated: boolean }> {
    if (input.signal.aborted) throw new DOMException('Material import was aborted.', 'AbortError');
    if (!this.#repository.getDossier(input.dossierId)) {
      throw new ProjectMaterialError('项目准备档案不存在。');
    }
    const fileName = safeFileName(input.fileName);
    const parsed = parseProjectMaterial(input.bytes, this.#ids);
    const physicalHash = parseContentHash(createHash('sha256').update(input.bytes).digest('hex'));
    const existing = this.#repository.findMaterialByName(input.dossierId, fileName);
    if (existing?.contentHash === physicalHash) return { material: existing, deduplicated: true };
    if (existing && existing.versionNo >= 5) {
      throw new ProjectMaterialError('该逻辑资料已达到 5 个版本，请使用新的文件名。');
    }
    const requestedFileId = this.#repository.claimMaterialFile({
      dossierId: input.dossierId,
      fileName,
      proposedFileId: existing?.fileId ?? this.#ids.generate(),
      now: input.createdAt,
    });
    const stored = await this.#artifacts.put({
      id: requestedFileId,
      kind: 'project_material',
      name: fileName,
      mediaType: 'text/markdown; charset=utf-8',
      content: input.bytes,
      createdAt: input.createdAt,
      logicalFile: 'reuse',
    });
    if (stored.id !== requestedFileId) {
      throw new ProjectMaterialError('项目资料逻辑文件身份发生冲突。');
    }
    return this.#repository.registerMaterial({
      dossierId: input.dossierId,
      fileId: stored.id,
      entityId: stored.entityId,
      fileName,
      normalizedText: parsed.normalizedText,
      parserVersion: projectMaterialParserVersion,
      chunks: parsed.chunks,
      now: input.createdAt,
    });
  }
}
