import { AgentRuntimeError, type AgentRunner } from '@jobhunter/agent-core';
import {
  assertGeneratedProjectQuestion,
  DomainError,
  parseId,
  type ContentHash,
  type DrillSessionId,
  type DrillTurnId,
  type TaskId,
  type UtcInstant,
} from '@jobhunter/domain';
import { z } from 'zod';
import { mapAgentRuntimeError } from '../agents/error-mapping.js';
import type { InterviewProjectRepository } from '../ports/interview-projects.js';
import { TaskExecutionError } from '../tasks/retry-policy.js';
import {
  docsGroundedProjectQuestionAgentDefinition,
  projectQuestionAgentDefinition,
} from './agents.js';
import { buildQuestionAgentInput, questionContextHash } from './context.js';

/** 同步问题生成可以向界面公开且不包含模型正文的真实执行阶段。 */
export type ProjectQuestionGenerationStage =
  'preparing_context' | 'generating_question' | 'validating_question' | 'saving_question';

/** 同步或遗留任务调用问题生成器时冻结的上下文定位参数。 */
export interface ProjectQuestionGenerationRequest {
  readonly dossierId: string;
  readonly sessionId: DrillSessionId;
  readonly turnId: DrillTurnId;
  readonly expectedContextRevision: number;
  readonly contextHash: ContentHash;
  readonly expectedTaskId?: TaskId;
  readonly signal: AbortSignal;
  readonly now: UtcInstant;
  readonly onStage?: (stage: ProjectQuestionGenerationStage) => void;
}

/** 已提交问题的安全定位结果，不向调用方重复返回模型原始输出。 */
export interface ProjectQuestionGenerationResult {
  readonly turnId: DrillTurnId;
  readonly agentRunId: string;
  readonly cacheHit: boolean;
}

/** 统一执行项目问题 Agent、后置安全校验和乐观提交。 */
export class ProjectQuestionGenerator {
  readonly #runner: AgentRunner;
  readonly #repository: InterviewProjectRepository;

  public constructor(input: {
    readonly runner: AgentRunner;
    readonly repository: InterviewProjectRepository;
  }) {
    this.#runner = input.runner;
    this.#repository = input.repository;
  }

  /** 在数据库事务外生成问题，只在最终提交时使用短事务。 */
  public async generate(
    input: ProjectQuestionGenerationRequest,
  ): Promise<ProjectQuestionGenerationResult> {
    // 1、读取并核验冻结上下文，拒绝已变化、已取消或被其他请求占用的回合。
    const source = this.#repository.getQuestionContext(input.turnId);
    if (
      source?.dossier.id !== input.dossierId ||
      source.session.id !== input.sessionId ||
      source.session.contextRevision !== input.expectedContextRevision ||
      source.turn.status !== 'question_pending' ||
      (input.expectedTaskId !== undefined && source.turn.questionTaskId !== input.expectedTaskId) ||
      source.turn.contextHash !== input.contextHash ||
      questionContextHash(source.session, source.turn.turnNo) !== input.contextHash
    ) {
      throw new TaskExecutionError('cancelled', 'Interview question context is stale.');
    }

    // 2、模型只接收应用层构造的最小上下文；3、完整输出通过证据和禁止代答校验后才可见。
    const agentInput = buildQuestionAgentInput(source);
    try {
      input.onStage?.('generating_question');
      const result = await this.#runner.run({
        definition:
          source.session.profileKey === 'docs-grounded'
            ? docsGroundedProjectQuestionAgentDefinition
            : projectQuestionAgentDefinition,
        value: agentInput,
        signal: input.signal,
      });
      input.onStage?.('validating_question');
      const question = assertGeneratedProjectQuestion(
        result.output,
        agentInput.allowedEvidenceRefs,
      );
      if (
        source.session.profileKey === 'docs-grounded' &&
        !question.evidenceRefs.some((reference) => reference.kind === 'project_material')
      ) {
        throw new DomainError(
          'INTERVIEW_EVIDENCE_INVALID',
          'Docs-grounded question must reference selected project material.',
        );
      }

      // 4、请求取消后不提交迟到结果；最终 CAS 再次保护会话修订和上下文哈希。
      input.onStage?.('saving_question');
      input.signal.throwIfAborted();
      const committed = this.#repository.completeQuestion({
        turnId: input.turnId,
        ...(input.expectedTaskId ? { expectedTaskId: input.expectedTaskId } : {}),
        expectedContextHash: source.turn.contextHash,
        expectedSessionRevision: source.session.contextRevision,
        ...question,
        agentRunId: parseId(result.run.id, 'AgentRun'),
        now: input.now,
      });
      if (!committed) {
        throw new TaskExecutionError('cancelled', 'Interview question result became stale.');
      }
      return { turnId: input.turnId, agentRunId: result.run.id, cacheHit: result.cacheHit };
    } catch (error) {
      if (error instanceof AgentRuntimeError) {
        throw mapAgentRuntimeError(error, 'Interview question Agent');
      }
      if (error instanceof DomainError || error instanceof z.ZodError) {
        throw new TaskExecutionError(
          'validation_failed',
          'Interview question output was rejected.',
          { cause: error },
        );
      }
      throw error;
    }
  }
}
