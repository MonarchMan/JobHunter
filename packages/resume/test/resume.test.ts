import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertPromptMatchesDefinition } from '@jobhunter/agent-core';
import { describe, expect, it } from 'vitest';
import {
  ResumeMediaError,
  TesseractResumeOcrEngine,
  detectResumeMediaType,
  extractResumeProfileByRules,
  parseResumeProfileAgentOutput,
  parseResumePolishAgentOutput,
  parseResumeText,
  resumeProfileAgentDefinition,
  resumeProfilePromptV1,
  resumePolishAgentDefinition,
  resumePolishPromptV1,
} from '../src/index.js';

const encoder = new TextEncoder();
const emptyPreferences = {
  locations: [],
  companySizes: [],
  employmentTypes: [],
  excludedTerms: [],
  remoteAccepted: null,
} as const;

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

describe('rule-first resume profile extraction', () => {
  const structuredResume = `候选人邮箱 candidate@example.com

求职意向
后端研发

教育经历
示例大学 | 本科 | 软件工程 | 2019.09-2023.06

工作/实习经历
示例科技 | 后端开发实习生 | 2022.07-2022.12
- 使用 TypeScript 开发任务调度接口
- 补充失败重试与监控告警

项目经历
任务调度系统 | 后端负责人 | 2023.01-2023.06
- 设计任务状态机与幂等执行机制
- 实现任务失败后的指数退避重试

专业技能
编程语言：TypeScript、Python`;

  it('maps clear sections and dated entries without a model', () => {
    const result = extractResumeProfileByRules(structuredResume, emptyPreferences);
    expect(result).toMatchObject({
      kind: 'extracted',
      profile: {
        basicInfo: { email: 'candidate@example.com' },
        targetRoles: ['后端研发'],
        education: [{ institution: '示例大学', degree: '本科', field: '软件工程' }],
        workExperience: [
          {
            organization: '示例科技',
            title: '后端开发实习生',
            highlights: ['使用 TypeScript 开发任务调度接口', '补充失败重试与监控告警'],
          },
        ],
        projects: [{ name: '任务调度系统', role: '后端负责人' }],
        skills: [{ name: 'TypeScript' }, { name: 'Python' }],
      },
    });
  });

  it('falls back as a whole when an experience entry has no explicit bullet structure', () => {
    const ambiguous = structuredResume.replace(
      '- 使用 TypeScript 开发任务调度接口\n- 补充失败重试与监控告警',
      '使用 TypeScript 开发任务调度接口并补充监控告警',
    );
    expect(extractResumeProfileByRules(ambiguous, emptyPreferences)).toEqual({
      kind: 'fallback',
      reason: 'ambiguous_entry',
    });
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

describe('resume polish Agent boundary schema', () => {
  const input = {
    targetRole: '研发',
    selectedSections: ['projects'] as const,
    workExperience: null,
    projects: [
      {
        name: '任务调度系统',
        role: '后端开发',
        highlights: ['开发任务重试功能', '降低失败任务人工处理成本'],
      },
    ],
  };

  it('keeps prompt and Agent versions aligned and accepts selected section suggestions', () => {
    expect(() => {
      assertPromptMatchesDefinition(resumePolishPromptV1, resumePolishAgentDefinition);
    }).not.toThrow();
    expect(
      parseResumePolishAgentOutput(
        {
          workExperience: null,
          projects: [['实现任务重试机制，降低失败任务的人工处理成本。']],
        },
        input,
      ),
    ).toEqual({
      workExperience: null,
      projects: [['实现任务重试机制，降低失败任务的人工处理成本。']],
    });
  });

  it('rejects content for unselected sections and changed entry counts', () => {
    expect(() =>
      parseResumePolishAgentOutput(
        { workExperience: [['不应出现']], projects: [['项目建议']] },
        input,
      ),
    ).toThrow(/Unselected resume section/);
    expect(() =>
      parseResumePolishAgentOutput({ workExperience: null, projects: [] }, input),
    ).toThrow(/does not match source section/);
  });
});
