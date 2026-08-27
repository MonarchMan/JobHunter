import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertPromptMatchesDefinition } from '@jobhunter/agent-core';
import { describe, expect, it } from 'vitest';
import {
  ResumeMediaError,
  TesseractResumeOcrEngine,
  detectResumeMediaType,
  parseResumeProfileAgentOutput,
  parseResumeText,
  resumeProfileAgentDefinition,
  resumeProfilePromptV1,
} from '../src/index.js';

const encoder = new TextEncoder();

describe('resume media detection and deterministic parsing', () => {
  it('accepts strict UTF-8 text and applies the pre-model quality and size gates', async () => {
    const text = '候选人具备 TypeScript、Python、RAG 和 Agent 系统开发经验。'.repeat(5);
    const bytes = encoder.encode(text);
    expect(detectResumeMediaType(bytes).mediaType).toBe('text/plain');
    await expect(parseResumeText(bytes, 'text/plain')).resolves.toMatchObject({
      status: 'parsed',
      text,
    });
    await expect(
      parseResumeText(bytes, 'text/plain', { maximumExtractedCharacters: 100 }),
    ).resolves.toMatchObject({ status: 'failed', text: null });
    await expect(parseResumeText(encoder.encode('太短'), 'text/plain')).resolves.toMatchObject({
      status: 'failed',
      text: null,
    });
  });

  it('rejects binary and non-DOCX ZIP input without trusting a file extension', () => {
    expect(() => detectResumeMediaType(new Uint8Array([0, 159, 146, 150]))).toThrow(
      ResumeMediaError,
    );
    const fakeZip = new Uint8Array(30);
    new DataView(fakeZip.buffer).setUint32(0, 0x04034b50, true);
    expect(() => detectResumeMediaType(fakeZip)).toThrow(/not a valid DOCX/);
  });

  it('detects resume images by content and defers them to OCR', async () => {
    const jpeg = await readFile(
      new URL('../../../docs/resumes/nowcoder_1787802316450.jpeg', import.meta.url),
    );
    expect(detectResumeMediaType(jpeg)).toMatchObject({
      mediaType: 'image/jpeg',
      byteSize: jpeg.byteLength,
    });
    await expect(parseResumeText(jpeg, 'image/jpeg')).resolves.toMatchObject({
      status: 'needs_ocr',
      parser: 'image',
      text: null,
    });

    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
    expect(detectResumeMediaType(png).mediaType).toBe('image/png');
  });

  it('recognizes stable education, skill and project anchors from the reference image locally', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'jobhunter-ocr-'));
    try {
      const jpeg = await readFile(
        new URL('../../../docs/resumes/nowcoder_1787802316450.jpeg', import.meta.url),
      );
      const result = await new TesseractResumeOcrEngine({ dataRoot: root }).recognize(
        jpeg,
        'image/jpeg',
      );
      expect(result.text).toContain('陕西师范大学');
      expect(result.text).toContain('python');
      expect(result.text).toContain('Prism');
      expect(result.text).toContain('SuperMew');
      expect(result.characterCount).toBeGreaterThan(1_000);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('honors cancellation before parser work starts', async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(
      parseResumeText(encoder.encode('readable text'.repeat(20)), 'text/plain', {
        signal: abort.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('resume profile Agent boundary schema', () => {
  it('keeps prompt, Agent and output schema versions consistent', () => {
    expect(() => {
      assertPromptMatchesDefinition(resumeProfilePromptV1, resumeProfileAgentDefinition);
    }).not.toThrow();
  });

  it('accepts evidence-backed facts while keeping user preferences out of Agent output', () => {
    const extracted = 'TypeScript 与 RAG Agent 应用开发经验';
    const start = extracted.indexOf('TypeScript');
    const end = start + 'TypeScript'.length;
    const output = parseResumeProfileAgentOutput(
      {
        targetRoles: [
          {
            value: 'Agent 开发',
            confidence: 0.9,
            evidenceRefs: [{ start, end, summary: 'TypeScript 项目技能' }],
          },
        ],
        education: [],
        workExperience: [],
        projects: [],
        skills: [
          {
            value: { name: 'TypeScript', level: 'proficient' },
            confidence: 0.95,
            evidenceRefs: [{ start, end, summary: '明确技能' }],
          },
        ],
        domains: [],
        yearsOfExperience: null,
        managementExperience: null,
      },
      extracted,
    );
    expect(output.skills[0]?.value.name).toBe('TypeScript');
    expect(output).not.toHaveProperty('preferences');
  });

  it('rejects facts whose evidence points outside the extracted resume', () => {
    expect(() =>
      parseResumeProfileAgentOutput(
        {
          targetRoles: [
            {
              value: 'Agent 开发',
              confidence: 0.9,
              evidenceRefs: [{ start: 0, end: 999, summary: '越界' }],
            },
          ],
          education: [],
          workExperience: [],
          projects: [],
          skills: [],
          domains: [],
          yearsOfExperience: null,
          managementExperience: null,
        },
        '短文本',
      ),
    ).toThrow(/range exceeds/);
  });
});
