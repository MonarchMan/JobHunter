import { describe, expect, it } from 'vitest';
import {
  assertAnswerDigest,
  assertCanRequestQuestion,
  assertCanSubmitAnswer,
  assertGeneratedProjectQuestion,
  DomainError,
  drillCoverageDimensions,
  nextSessionStatus,
} from '../src/index.js';

const snapshotId = '018f0000-0000-7000-8000-000000000101';

describe('interview project drill', () => {
  it('accepts a bounded question with allowed evidence', () => {
    expect(
      assertGeneratedProjectQuestion(
        {
          question: '这个项目最初要解决什么业务问题，你如何判断目标已经达成？',
          intent: '确认项目背景、目标和成功标准。',
          primaryDimension: 'background_goal',
          guidanceSlots: ['业务背景', '目标用户', '成功标准'],
          evidenceRefs: [{ kind: 'resume_project', id: snapshotId }],
        },
        [{ kind: 'resume_project', id: snapshotId }],
      ),
    ).toMatchObject({ primaryDimension: 'background_goal' });
  });

  it('rejects answer-like content, project access and unknown evidence', () => {
    const base = {
      intent: '追问实现细节。',
      primaryDimension: 'key_implementation',
      guidanceSlots: ['关键步骤'],
      evidenceRefs: [{ kind: 'resume_project', id: snapshotId }],
    } as const;
    expect(() =>
      assertGeneratedProjectQuestion(
        { ...base, question: '我负责实现服务并采用缓存，最终延迟下降。' },
        base.evidenceRefs,
      ),
    ).toThrow(DomainError);
    expect(() =>
      assertGeneratedProjectQuestion(
        {
          ...base,
          question: '你会如何解释这个方案的关键实现？',
          guidanceSlots: ['我采用缓存并将延迟降到 80ms。'],
        },
        base.evidenceRefs,
      ),
    ).toThrow(/answer-like/);
    expect(() =>
      assertGeneratedProjectQuestion(
        { ...base, question: '请读取项目目录中的源码后说明关键实现。' },
        base.evidenceRefs,
      ),
    ).toThrow(/prohibited project access/);
    expect(() =>
      assertGeneratedProjectQuestion(
        {
          ...base,
          question: '你为什么选择这个实现方案，当时还有哪些备选？',
          evidenceRefs: [{ kind: 'derived_claim', id: '018f0000-0000-7000-8000-000000000102' }],
        },
        base.evidenceRefs,
      ),
    ).toThrow(/not in context/);
  });

  it('validates exact answer evidence offsets and coverage references', () => {
    const answer = '我负责缓存层，接口延迟从 300ms 降到 80ms。';
    const quote = '接口延迟从 300ms 降到 80ms';
    const start = answer.indexOf(quote);
    const valid = {
      knowledgeItems: [
        { kind: 'metric', statement: '接口延迟明显下降', quote, start, end: start + quote.length },
      ],
      coverageUpdates: [
        { dimension: 'data_metrics', status: 'evidence_sufficient', evidenceItemIndexes: [0] },
      ],
    } as const;
    expect(assertAnswerDigest(valid, answer).knowledgeItems).toHaveLength(1);
    expect(() =>
      assertAnswerDigest(
        {
          ...valid,
          knowledgeItems: [{ ...valid.knowledgeItems[0], end: start + quote.length - 1 }],
        },
        answer,
      ),
    ).toThrow(/quote does not match/);
  });

  it('enforces session and turn transitions without scores', () => {
    expect(drillCoverageDimensions).toHaveLength(10);
    expect(nextSessionStatus('active', 'pause')).toBe('paused');
    expect(nextSessionStatus('paused', 'resume')).toBe('active');
    expect(() => {
      nextSessionStatus('completed', 'resume');
    }).toThrow(DomainError);
    expect(() => {
      assertCanRequestQuestion('paused', null);
    }).toThrow(DomainError);
    expect(() => {
      assertCanRequestQuestion('active', 'awaiting_answer');
    }).toThrow(DomainError);
    expect(() => {
      assertCanSubmitAnswer('active', 'question_pending');
    }).toThrow(DomainError);
  });
});
