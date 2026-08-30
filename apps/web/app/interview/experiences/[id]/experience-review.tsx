'use client';

import type { ExperienceDocumentDetail } from '@jobhunter/application/web';
import type { InterviewExperienceDraft } from '@jobhunter/domain';
import { useRouter } from 'next/navigation.js';
import type { ReactElement, SyntheticEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { mutationHeaders } from '../../../../src/client/csrf.js';
import styles from './experience-review.module.css';

interface ApiEnvelope<T> {
  readonly data?: T;
  readonly error?: { readonly message?: string };
}

interface DeletionImpact {
  readonly impactHash: string;
  readonly counts: {
    readonly experiences: number;
    readonly questions: number;
    readonly artifacts: number;
  };
}

const warningLabels = {
  missing_company: '有经历没有填写公司，请确认是否需要补充。',
  missing_role: '有经历没有填写岗位，请确认是否需要补充。',
  no_questions: '没有识别出问题，请手动添加至少一个问题。',
  unanswered_questions: '部分问题没有答案；可以保留为空，也可以补充当时的回答。',
  unclassified_notes: '文档中有未归类内容，已保留在“过程与备注”。',
} as const;

const experienceTextFields = [
  ['company', '公司', 200],
  ['role', '岗位', 200],
  ['stage', '面试阶段', 100],
  ['outcome', '结果', 100],
  ['difficulty', '难度', 100],
] as const;

function draftsFrom(detail: ExperienceDocumentDetail): readonly InterviewExperienceDraft[] {
  return detail.experiences.map((experience) => ({
    sequenceNo: experience.sequenceNo,
    company: experience.company,
    role: experience.role,
    stage: experience.stage,
    occurredOn: experience.occurredOn,
    outcome: experience.outcome,
    difficulty: experience.difficulty,
    tags: experience.tags,
    notes: experience.notes,
    questions: detail.questions
      .filter((question) => question.experienceId === experience.id)
      .sort((left, right) => left.sequenceNo - right.sequenceNo)
      .map((question) => ({
        sequenceNo: question.sequenceNo,
        question: question.question,
        answer: question.answer,
        reflection: question.reflection,
        questionEvidence: question.questionEvidence,
        answerEvidence: question.answerEvidence,
      })),
  }));
}

function text(value: string): string | null {
  return value.trim() || null;
}

function validateDrafts(drafts: readonly InterviewExperienceDraft[]): void {
  if (drafts.some((draft) => draft.questions.some((question) => !question.question.trim()))) {
    throw new Error('每一项都需要填写问题；暂时不需要的空问题可以删除。');
  }
  if (drafts.some((draft) => draft.tags.length > 30)) {
    throw new Error('每段经历最多保留 30 个标签。');
  }
}

export function ExperienceReview({
  detail,
}: Readonly<{ detail: ExperienceDocumentDetail }>): ReactElement {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelDelete = useRef<HTMLButtonElement>(null);
  const feedbackRef = useRef<HTMLParagraphElement>(null);
  const [drafts, setDrafts] = useState(() => draftsFrom(detail));
  const [revision, setRevision] = useState(detail.document.revision);
  const [status, setStatus] = useState(detail.document.status);
  const [warnings, setWarnings] = useState(detail.document.warnings);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<'save' | 'accept' | 'delete' | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [impact, setImpact] = useState<DeletionImpact | null>(null);
  const [confirmation, setConfirmation] = useState('');

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
    };
  }, [dirty]);

  const updateExperience = (
    experienceIndex: number,
    update: (draft: InterviewExperienceDraft) => InterviewExperienceDraft,
  ): void => {
    setDrafts(drafts.map((draft, index) => (index === experienceIndex ? update(draft) : draft)));
    setDirty(true);
    setFeedback(null);
    setError(null);
  };

  const persist = async (announce: boolean): Promise<ExperienceDocumentDetail> => {
    validateDrafts(drafts);
    const response = await fetch(`/api/interview/experiences/${detail.document.id}/draft`, {
      method: 'PUT',
      headers: await mutationHeaders(),
      body: JSON.stringify({ expectedRevision: revision, experiences: drafts }),
    });
    const body = (await response.json()) as ApiEnvelope<ExperienceDocumentDetail>;
    if (!response.ok || !body.data) {
      throw new Error(body.error?.message ?? '无法保存面经草稿。');
    }
    setDrafts(draftsFrom(body.data));
    setRevision(body.data.document.revision);
    setWarnings(body.data.document.warnings);
    setDirty(false);
    if (announce) setFeedback('草稿已保存。');
    return body.data;
  };

  const handleSave = async (event: SyntheticEvent<HTMLFormElement, SubmitEvent>): Promise<void> => {
    event.preventDefault();
    setBusy('save');
    setError(null);
    setFeedback(null);
    try {
      await persist(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '无法保存面经草稿。');
      queueMicrotask(() => {
        feedbackRef.current?.focus();
      });
    } finally {
      setBusy(null);
    }
  };

  const handleAccept = async (): Promise<void> => {
    setBusy('accept');
    setError(null);
    setFeedback(null);
    try {
      const saved = await persist(false);
      const response = await fetch(`/api/interview/experiences/${detail.document.id}/accept`, {
        method: 'POST',
        headers: await mutationHeaders(),
        body: JSON.stringify({ expectedRevision: saved.document.revision }),
      });
      const body = (await response.json()) as ApiEnvelope<ExperienceDocumentDetail>;
      if (!response.ok || !body.data) {
        throw new Error(body.error?.message ?? '无法接受面经草稿。');
      }
      setRevision(body.data.document.revision);
      setStatus('accepted');
      setDirty(false);
      setFeedback('已进入历史面经。');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '无法接受面经草稿。');
      queueMicrotask(() => {
        feedbackRef.current?.focus();
      });
    } finally {
      setBusy(null);
    }
  };

  if (status === 'accepted') {
    return (
      <div className={styles.root}>
        <section className={styles.acceptedBanner} aria-labelledby="accepted-title">
          <span aria-hidden="true" />
          <div>
            <h2 id="accepted-title">已进入历史面经</h2>
            <p>这里保留你确认过的问题与回答，不会被后续解析规则静默改写。</p>
          </div>
        </section>
        <ExperienceReadOnly drafts={drafts} />
        <DeletionArea
          documentId={detail.document.id}
          fileName={detail.document.fileName}
          dialog={dialog}
          cancelDelete={cancelDelete}
          impact={impact}
          setImpact={setImpact}
          confirmation={confirmation}
          setConfirmation={setConfirmation}
          busy={busy}
          setBusy={setBusy}
          setError={setError}
          router={router}
        />
        {error ? (
          <p className="form-feedback error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <section className={styles.reviewLead} aria-labelledby="review-title">
        <span aria-hidden="true" />
        <div>
          <h2 id="review-title">校对后再入库</h2>
          <p>解析结果只是草稿。请确认拆分、问题和回答，不清楚的内容可以继续留空。</p>
        </div>
        <dl>
          <div>
            <dt>来源</dt>
            <dd>
              {detail.document.sourceMode === 'online' ? '在线填写' : detail.document.fileName}
            </dd>
          </div>
          <div>
            <dt>解析器</dt>
            <dd>{detail.document.parserVersion}</dd>
          </div>
        </dl>
      </section>

      {warnings.length > 0 ? (
        <section className={styles.warnings} aria-labelledby="warnings-title">
          <h3 id="warnings-title">需要核对</h3>
          <ul>
            {warnings.map((warning) => (
              <li key={warning}>{warningLabels[warning]}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <form
        className={styles.form}
        aria-labelledby="review-title"
        noValidate
        onSubmit={(event) => {
          void handleSave(event);
        }}
      >
        {drafts.map((draft, experienceIndex) => (
          <section className={styles.experience} key={experienceIndex}>
            <div className={styles.experienceHeading}>
              <span>{String(experienceIndex + 1).padStart(2, '0')}</span>
              <div>
                <h3>经历 {experienceIndex + 1}</h3>
              </div>
            </div>
            <div className={styles.fieldGrid}>
              {experienceTextFields.map(([key, label, maximum]) => (
                <label key={key}>
                  {label}
                  <input
                    value={draft[key] ?? ''}
                    maxLength={maximum}
                    onChange={(event) => {
                      updateExperience(experienceIndex, (current) => ({
                        ...current,
                        [key]: text(event.target.value),
                      }));
                    }}
                  />
                </label>
              ))}
              <label>
                面试日期
                <input
                  type="date"
                  value={draft.occurredOn ?? ''}
                  onChange={(event) => {
                    updateExperience(experienceIndex, (current) => ({
                      ...current,
                      occurredOn: text(event.target.value),
                    }));
                  }}
                />
              </label>
              <label className={styles.fullField}>
                标签
                <input
                  value={draft.tags.join('、')}
                  maxLength={3_000}
                  onChange={(event) => {
                    updateExperience(experienceIndex, (current) => ({
                      ...current,
                      tags: event.target.value
                        .split(/[,，、]/)
                        .map((item) => item.trim())
                        .filter(Boolean),
                    }));
                  }}
                />
              </label>
            </div>

            <div className={styles.questionHeading}>
              <div>
                <h4>问题与回答</h4>
                <p>{draft.questions.length} 个问题</p>
              </div>
              <button
                type="button"
                className="button-secondary"
                onClick={() => {
                  updateExperience(experienceIndex, (current) => ({
                    ...current,
                    questions: [
                      ...current.questions,
                      {
                        sequenceNo: current.questions.length + 1,
                        question: '',
                        answer: null,
                        reflection: null,
                        questionEvidence: null,
                        answerEvidence: null,
                      },
                    ],
                  }));
                }}
              >
                添加问题
              </button>
            </div>
            <ol className={styles.questionList}>
              {draft.questions.map((question, questionIndex) => (
                <li key={questionIndex}>
                  <div className={styles.questionLabel}>
                    <span>Q{String(questionIndex + 1).padStart(2, '0')}</span>
                    <button
                      type="button"
                      className="button-ghost"
                      onClick={() => {
                        updateExperience(experienceIndex, (current) => ({
                          ...current,
                          questions: current.questions
                            .filter((_, index) => index !== questionIndex)
                            .map((item, index) => ({ ...item, sequenceNo: index + 1 })),
                        }));
                      }}
                    >
                      删除此题
                    </button>
                  </div>
                  <label>
                    问题
                    <textarea
                      className="resize-none"
                      rows={3}
                      maxLength={5_000}
                      value={question.question}
                      onChange={(event) => {
                        updateExperience(experienceIndex, (current) => ({
                          ...current,
                          questions: current.questions.map((item, index) =>
                            index === questionIndex
                              ? { ...item, question: event.target.value, questionEvidence: null }
                              : item,
                          ),
                        }));
                      }}
                    />
                  </label>
                  <label>
                    当时的回答（可留空）
                    <textarea
                      className="resize-none"
                      rows={5}
                      maxLength={20_000}
                      value={question.answer ?? ''}
                      onChange={(event) => {
                        updateExperience(experienceIndex, (current) => ({
                          ...current,
                          questions: current.questions.map((item, index) =>
                            index === questionIndex
                              ? { ...item, answer: text(event.target.value), answerEvidence: null }
                              : item,
                          ),
                        }));
                      }}
                    />
                  </label>
                  <label>
                    复盘（可选）
                    <textarea
                      className="resize-none"
                      rows={3}
                      maxLength={10_000}
                      value={question.reflection ?? ''}
                      onChange={(event) => {
                        updateExperience(experienceIndex, (current) => ({
                          ...current,
                          questions: current.questions.map((item, index) =>
                            index === questionIndex
                              ? { ...item, reflection: text(event.target.value) }
                              : item,
                          ),
                        }));
                      }}
                    />
                  </label>
                </li>
              ))}
            </ol>
            <label className={styles.notes}>
              过程与备注
              <textarea
                className="resize-none"
                rows={6}
                maxLength={20_000}
                value={draft.notes ?? ''}
                onChange={(event) => {
                  updateExperience(experienceIndex, (current) => ({
                    ...current,
                    notes: text(event.target.value),
                  }));
                }}
              />
            </label>
          </section>
        ))}

        <div className={styles.actionBar}>
          <div>
            <button type="submit" className="button-secondary" disabled={busy !== null}>
              {busy === 'save' ? '正在保存…' : '保存草稿'}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => {
                void handleAccept();
              }}
            >
              {busy === 'accept' ? '正在入库…' : '接受为历史面经'}
            </button>
          </div>
          <span>{dirty ? '有未保存修改' : '草稿与本地记录一致'}</span>
        </div>
      </form>

      {error ? (
        <p className="form-feedback error" role="alert" tabIndex={-1} ref={feedbackRef}>
          {error}
        </p>
      ) : null}
      {feedback ? (
        <p className="form-feedback success" role="status">
          {feedback}
        </p>
      ) : null}

      <DeletionArea
        documentId={detail.document.id}
        fileName={detail.document.fileName}
        dialog={dialog}
        cancelDelete={cancelDelete}
        impact={impact}
        setImpact={setImpact}
        confirmation={confirmation}
        setConfirmation={setConfirmation}
        busy={busy}
        setBusy={setBusy}
        setError={setError}
        router={router}
      />
    </div>
  );
}

function ExperienceReadOnly({
  drafts,
}: Readonly<{ drafts: readonly InterviewExperienceDraft[] }>): ReactElement {
  return (
    <div className={styles.readOnly}>
      {drafts.map((draft, index) => (
        <article key={index}>
          <header>
            <span>{String(index + 1).padStart(2, '0')}</span>
            <div>
              <h3>
                {draft.company ?? '公司待补充'} · {draft.role ?? '岗位待补充'}
              </h3>
              <p>
                {draft.stage ?? '阶段待补充'} · {draft.occurredOn ?? '日期待补充'}
              </p>
            </div>
          </header>
          <ol>
            {draft.questions.map((question, questionIndex) => (
              <li key={questionIndex}>
                <h4>
                  Q{questionIndex + 1} · {question.question}
                </h4>
                <p>{question.answer ?? '当时未记录答案'}</p>
                {question.reflection ? (
                  <aside>
                    <strong>复盘</strong>
                    <p>{question.reflection}</p>
                  </aside>
                ) : null}
              </li>
            ))}
          </ol>
          {draft.notes ? (
            <footer>
              <strong>过程与备注</strong>
              <p>{draft.notes}</p>
            </footer>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function DeletionArea({
  documentId,
  fileName,
  dialog,
  cancelDelete,
  impact,
  setImpact,
  confirmation,
  setConfirmation,
  busy,
  setBusy,
  setError,
  router,
}: Readonly<{
  documentId: string;
  fileName: string;
  dialog: React.RefObject<HTMLDialogElement | null>;
  cancelDelete: React.RefObject<HTMLButtonElement | null>;
  impact: DeletionImpact | null;
  setImpact: (value: DeletionImpact | null) => void;
  confirmation: string;
  setConfirmation: (value: string) => void;
  busy: 'save' | 'accept' | 'delete' | null;
  setBusy: (value: 'save' | 'accept' | 'delete' | null) => void;
  setError: (value: string | null) => void;
  router: ReturnType<typeof useRouter>;
}>): ReactElement {
  const handlePreview = async (): Promise<void> => {
    setError(null);
    try {
      const response = await fetch(`/api/interview/experiences/${documentId}/deletion`);
      const body = (await response.json()) as ApiEnvelope<DeletionImpact>;
      if (!response.ok || !body.data) {
        throw new Error(body.error?.message ?? '无法读取删除影响。');
      }
      setImpact(body.data);
      setConfirmation('');
      dialog.current?.showModal();
      queueMicrotask(() => {
        cancelDelete.current?.focus();
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '无法读取删除影响。');
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!impact) return;
    setBusy('delete');
    setError(null);
    try {
      const response = await fetch(`/api/interview/experiences/${documentId}/deletion`, {
        method: 'DELETE',
        headers: await mutationHeaders(),
        body: JSON.stringify({
          expectedImpactHash: impact.impactHash,
          confirmation: 'DELETE',
        }),
      });
      const body = (await response.json()) as ApiEnvelope<unknown>;
      if (!response.ok || !body.data) {
        throw new Error(body.error?.message ?? '无法删除个人面经。');
      }
      dialog.current?.close();
      router.push('/interview/experiences');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '无法删除个人面经。');
      setBusy(null);
    }
  };

  return (
    <section className={styles.dangerZone} aria-labelledby="delete-experience-title">
      <div>
        <h2 id="delete-experience-title">删除这份个人面经</h2>
        <p>删除会移除该文档派生的经历和问题；共享的原文件不会被误删。</p>
      </div>
      <button
        type="button"
        className="button-danger"
        onClick={() => {
          void handlePreview();
        }}
      >
        查看删除影响
      </button>
      <dialog
        ref={dialog}
        className={styles.dialog}
        aria-labelledby="delete-experience-dialog-title"
        onClose={() => {
          setImpact(null);
          setConfirmation('');
        }}
      >
        <form
          method="dialog"
          className={styles.dialogPanel}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
          }}
        >
          <h2 id="delete-experience-dialog-title">删除“{fileName}”</h2>
          <p>
            将删除 {impact?.counts.experiences ?? 0} 段经历、{impact?.counts.questions ?? 0}{' '}
            个问题和 {impact?.counts.artifacts ?? 0} 个独占原文件。此操作无法撤销。
          </p>
          <label>
            输入 DELETE 确认
            <input
              value={confirmation}
              onChange={(event) => {
                setConfirmation(event.target.value);
              }}
              aria-describedby="delete-experience-help"
            />
          </label>
          <small id="delete-experience-help">如果数据在确认前发生变化，系统会要求重新预览。</small>
          <div>
            <button
              ref={cancelDelete}
              type="button"
              className="button-secondary"
              disabled={busy === 'delete'}
              onClick={() => {
                dialog.current?.close();
              }}
            >
              取消
            </button>
            <button
              type="button"
              className="button-danger"
              disabled={busy === 'delete' || confirmation !== 'DELETE'}
              onClick={() => {
                void handleDelete();
              }}
            >
              {busy === 'delete' ? '正在删除…' : '永久删除'}
            </button>
          </div>
        </form>
      </dialog>
    </section>
  );
}
