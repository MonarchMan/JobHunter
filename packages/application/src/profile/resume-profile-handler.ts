import { AgentRuntimeError, type AgentRunner } from '@jobhunter/agent-core';
import { parseId } from '@jobhunter/domain';
import {
  isResumeOcrMediaType,
  extractResumeProfileByRules,
  parseResumeProfileAgentOutput,
  ResumeOcrError,
  resumeProfileAgentDefinition,
  toCandidateProfile,
  type CandidatePreferences,
  type ResumeOcrEngine,
} from '@jobhunter/resume';
import { z } from 'zod';
import type {
  ResumeArtifactReader,
  ResumeDocumentRecord,
  ResumeDocumentRepository,
} from '../ports/resume-documents.js';
import { mapAgentRuntimeError } from '../agents/error-mapping.js';
import type { TaskHandler } from '../tasks/model.js';
import { TaskExecutionError } from '../tasks/retry-policy.js';
import type { CandidateProfileService } from './candidate-profile-service.js';

/** 简历画像任务输入，绑定文档和档案版本。 */
export const resumeProfileTaskPayloadSchema = z
  .object({
    profileId: z.string().trim().min(1),
    resumeDocumentId: z.string().trim().min(1),
    expectedCurrentVersionId: z.string().trim().min(1).nullable(),
  })
  .strict();

/** 简历画像任务输出。 */
export const resumeProfileTaskOutputSchema = z
  .object({
    agentRunId: z.string().trim().min(1).nullable(),
    profileVersionId: z.string().trim().min(1),
    cacheHit: z.boolean(),
    extractionMethod: z.enum(['rules', 'llm']),
  })
  .strict();

const emptyPreferences: CandidatePreferences = {
  locations: [],
  companySizes: [],
  employmentTypes: [],
  excludedTerms: [],
  remoteAccepted: null,
};

/** 创建简历画像 Agent 任务处理器。 */
export function createResumeProfileTaskHandler(
  // 1、校验导入文档状态；2、运行画像 Agent；3、校验结构化画像；4、追加档案版本。
  input:
    | {
        readonly runner?: AgentRunner;
        readonly documents: ResumeDocumentRepository;
        readonly profiles: CandidateProfileService;
        readonly ocr?: {
          readonly engine: ResumeOcrEngine;
          readonly artifacts: ResumeArtifactReader;
          readonly maximumFileBytes?: number;
          readonly minimumNonWhitespaceCharacters?: number;
          readonly maximumExtractedCharacters?: number;
        };
      }
    | { readonly unavailable: true },
): TaskHandler<
  z.infer<typeof resumeProfileTaskPayloadSchema>,
  z.infer<typeof resumeProfileTaskOutputSchema>
> {
  return {
    taskType: 'resume.profile.extract',
    payloadSchema: resumeProfileTaskPayloadSchema,
    outputSchema: resumeProfileTaskOutputSchema,
    defaultMaxAttempts: 3,
    leaseDurationMs: 180_000,
    concurrencyKey: (payload) => `resume-profile:${payload.profileId}`,
    /** 执行应用适配器的该项操作。 */
    async execute(context, payload) {
      if ('unavailable' in input)
        throw new TaskExecutionError(
          'invalid_config',
          'Resume profile extraction is not available.',
        );
      let document = input.documents.getById(payload.resumeDocumentId);
      if (document?.parseStatus === 'needs_ocr') {
        document = await completeDocumentOcr(input, document, context.signal);
      }
      if (document?.parseStatus !== 'parsed' || document.extractedText === null) {
        throw new TaskExecutionError(
          'validation_failed',
          'Resume document is missing or has no parsed text.',
        );
      }
      const profileId = parseId(payload.profileId, 'CandidateProfile');
      const preferences =
        input.profiles.getCurrent(profileId)?.effective.preferences ?? emptyPreferences;
      const ruled = extractResumeProfileByRules(document.extractedText, preferences);
      if (ruled.kind === 'extracted') {
        const version = input.profiles.applyExtraction({
          profileId,
          expectedCurrentVersionId:
            payload.expectedCurrentVersionId === null
              ? null
              : parseId(payload.expectedCurrentVersionId, 'ProfileVersion'),
          resumeDocumentId: document.id,
          agentRunId: null,
          extracted: ruled.profile,
        });
        return {
          agentRunId: null,
          profileVersionId: version.id,
          cacheHit: false,
          extractionMethod: 'rules',
        };
      }
      context.logger.info('resume.profile.rules_fallback', { reason: ruled.reason });
      if (!input.runner) {
        throw new TaskExecutionError('invalid_config', 'Resume profile model is not configured.');
      }
      try {
        const result = await input.runner.run({
          definition: resumeProfileAgentDefinition,
          value: { extractedText: document.extractedText },
          signal: context.signal,
        });
        const facts = parseResumeProfileAgentOutput(result.output, document.extractedText);
        const version = input.profiles.applyExtraction({
          profileId,
          expectedCurrentVersionId:
            payload.expectedCurrentVersionId === null
              ? null
              : parseId(payload.expectedCurrentVersionId, 'ProfileVersion'),
          resumeDocumentId: document.id,
          agentRunId: result.run.id,
          extracted: toCandidateProfile(facts, preferences),
        });
        return {
          agentRunId: result.run.id,
          profileVersionId: version.id,
          cacheHit: result.cacheHit,
          extractionMethod: 'llm',
        };
      } catch (error) {
        if (error instanceof AgentRuntimeError) {
          throw mapAgentRuntimeError(error, 'Resume profile Agent');
        }
        throw error;
      }
    },
  };
}

/** 执行应用层的解析、转换或编排辅助逻辑。 */
async function completeDocumentOcr(
  input: {
    readonly documents: ResumeDocumentRepository;
    readonly ocr?: {
      readonly engine: ResumeOcrEngine;
      readonly artifacts: ResumeArtifactReader;
      readonly maximumFileBytes?: number;
      readonly minimumNonWhitespaceCharacters?: number;
      readonly maximumExtractedCharacters?: number;
    };
  },
  document: ResumeDocumentRecord,
  signal: AbortSignal,
): Promise<ResumeDocumentRecord> {
  if (!isResumeOcrMediaType(document.mediaType)) {
    throw new TaskExecutionError(
      'validation_failed',
      'Image-based PDF OCR is not supported; upload a JPEG or PNG image.',
    );
  }
  if (!input.ocr) {
    throw new TaskExecutionError('invalid_config', 'Resume OCR is not configured.');
  }
  let bytes: Uint8Array;
  try {
    bytes = await input.ocr.artifacts.read(
      document.artifactId,
      input.ocr.maximumFileBytes ?? 10 * 1024 * 1024,
      signal,
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new TaskExecutionError('io_temporary', 'Resume image could not be read.', {
      cause: error,
    });
  }
  try {
    const result = await input.ocr.engine.recognize(bytes, document.mediaType, {
      minimumNonWhitespaceCharacters: input.ocr.minimumNonWhitespaceCharacters ?? 80,
      maximumExtractedCharacters: input.ocr.maximumExtractedCharacters ?? 250_000,
      signal,
    });
    return input.documents.completeOcr({
      id: document.id,
      extractedText: result.text,
      parserVersion: result.engineVersion,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    if (error instanceof ResumeOcrError) {
      const validationFailure = error.code === 'low_quality' || error.code === 'text_too_large';
      throw new TaskExecutionError(
        validationFailure ? 'validation_failed' : 'io_temporary',
        validationFailure
          ? 'Resume OCR did not produce usable text.'
          : 'Resume OCR is temporarily unavailable.',
        { cause: error },
      );
    }
    throw error;
  }
}
