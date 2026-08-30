'use client';

import type { ExperienceDocumentSummary } from '@jobhunter/application/web';
import { useRouter } from 'next/navigation.js';
import type { DragEvent, ReactElement, SyntheticEvent } from 'react';
import { useRef, useState } from 'react';
import { mutationHeaders } from '../../../src/client/csrf.js';
import styles from './experience-intake.module.css';

interface ApiEnvelope<T> {
  readonly data?: T;
  readonly error?: { readonly message?: string };
}

interface OnlineQuestion {
  readonly key: number;
  readonly question: string;
  readonly answer: string;
  readonly reflection: string;
}

const maximumFileBytes = 10 * 1024 * 1024;
const acceptedExtensions = ['.md', '.markdown', '.txt', '.pdf', '.docx'];

function nullable(value: string): string | null {
  return value.trim() || null;
}

function dateLabel(value: string | null): string {
  return value ?? '日期待补充';
}

function formValue(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

export function ExperienceIntake({
  template,
  documents,
}: Readonly<{
  template: {
    readonly version: string;
    readonly fileName: string;
    readonly markdown: string;
  };
  documents: readonly ExperienceDocumentSummary[];
}>): ReactElement {
  const router = useRouter();
  const firstError = useRef<HTMLParagraphElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [onlineBusy, setOnlineBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextQuestionKey, setNextQuestionKey] = useState(2);
  const [questions, setQuestions] = useState<readonly OnlineQuestion[]>([
    { key: 1, question: '', answer: '', reflection: '' },
  ]);

  const chooseFile = (candidate: File | null): void => {
    setError(null);
    if (!candidate) {
      setFile(null);
      return;
    }
    const lower = candidate.name.toLowerCase();
    if (!acceptedExtensions.some((extension) => lower.endsWith(extension))) {
      setFile(null);
      setError('请选择 Markdown、TXT、PDF 或 DOCX 文件。');
      return;
    }
    if (candidate.size < 1 || candidate.size > maximumFileBytes) {
      setFile(null);
      setError('文件必须大于 0 且不超过 10 MiB。');
      return;
    }
    setFile(candidate);
  };

  const goToDraft = (body: ApiEnvelope<{ documentId: string }>): void => {
    if (!body.data) throw new Error(body.error?.message ?? '没有生成可校对的面经草稿。');
    router.push(`/interview/experiences/${body.data.documentId}`);
  };

  const handleUpload = async (
    event: SyntheticEvent<HTMLFormElement, SubmitEvent>,
  ): Promise<void> => {
    event.preventDefault();
    if (!file) {
      setError('请先选择一份面经文件。');
      queueMicrotask(() => {
        firstError.current?.focus();
      });
      return;
    }
    setUploadBusy(true);
    setError(null);
    try {
      const data = new FormData();
      data.set('file', file);
      const response = await fetch('/api/interview/experiences/imports', {
        method: 'POST',
        headers: await mutationHeaders(false),
        body: data,
      });
      goToDraft((await response.json()) as ApiEnvelope<{ documentId: string }>);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '无法导入面经文件。');
      setUploadBusy(false);
      queueMicrotask(() => {
        firstError.current?.focus();
      });
    }
  };

  const handleOnlineEntry = async (
    event: SyntheticEvent<HTMLFormElement, SubmitEvent>,
  ): Promise<void> => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const prepared = questions.map((question) => ({
      question: question.question.trim(),
      answer: nullable(question.answer),
      reflection: nullable(question.reflection),
    }));
    if (prepared.some((question) => !question.question)) {
      setError('每一项都需要填写问题；暂时不需要的空问题可以删除。');
      queueMicrotask(() => {
        firstError.current?.focus();
      });
      return;
    }
    setOnlineBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/interview/experiences/online', {
        method: 'POST',
        headers: await mutationHeaders(),
        body: JSON.stringify({
          company: nullable(formValue(form, 'company')),
          role: nullable(formValue(form, 'role')),
          stage: nullable(formValue(form, 'stage')),
          occurredOn: nullable(formValue(form, 'occurredOn')),
          outcome: nullable(formValue(form, 'outcome')),
          difficulty: nullable(formValue(form, 'difficulty')),
          tags: formValue(form, 'tags')
            .split(/[,，、]/)
            .map((item) => item.trim())
            .filter(Boolean),
          notes: nullable(formValue(form, 'notes')),
          questions: prepared,
        }),
      });
      goToDraft((await response.json()) as ApiEnvelope<{ documentId: string }>);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '无法保存在线面经。');
      setOnlineBusy(false);
      queueMicrotask(() => {
        firstError.current?.focus();
      });
    }
  };

  return (
    <div className={styles.root}>
      <section className={styles.intakeGrid} aria-labelledby="intake-title">
        <div className={styles.guideColumn}>
          <div className={styles.decisionHeading}>
            <span aria-hidden="true" />
            <div>
              <h2 id="intake-title">先记录，再校对</h2>
              <p>标准模板和在线填写会汇入同一条清洗管线，不会自动补写答案。</p>
            </div>
          </div>

          <article className={styles.templateSheet}>
            <header>
              <div>
                <h3>个人面经 Markdown 模板</h3>
              </div>
              <span>{template.version}</span>
            </header>
            <p>适合先在本地整理，也可以交给其他文本工具生成后再导入。</p>
            <div className={styles.templateActions}>
              <a className="button-secondary" href="/api/interview/experiences/template">
                下载模板
              </a>
              <details>
                <summary>查看模板内容</summary>
                <pre>{template.markdown}</pre>
              </details>
            </div>
          </article>

          <form
            className={styles.uploadForm}
            aria-labelledby="upload-experience-title"
            noValidate
            onSubmit={(event) => {
              void handleUpload(event);
            }}
          >
            <div className={styles.formHeading}>
              <div>
                <h3 id="upload-experience-title">导入已有文档</h3>
              </div>
              <small>单文件 · 最大 10 MiB</small>
            </div>
            <label
              className={styles.dropzone}
              data-experience-dropzone
              onDragOver={(event: DragEvent<HTMLLabelElement>) => {
                event.preventDefault();
                event.currentTarget.dataset.dragging = 'true';
              }}
              onDragLeave={(event) => {
                delete event.currentTarget.dataset.dragging;
              }}
              onDrop={(event: DragEvent<HTMLLabelElement>) => {
                event.preventDefault();
                delete event.currentTarget.dataset.dragging;
                chooseFile(event.dataTransfer.files[0] ?? null);
              }}
            >
              <strong>{file?.name ?? '点击选择或拖入面经文件'}</strong>
              <span>Markdown / TXT / PDF / DOCX</span>
              <input
                type="file"
                name="file"
                accept=".md,.markdown,.txt,.pdf,.docx,text/markdown,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={(event) => {
                  chooseFile(event.currentTarget.files?.[0] ?? null);
                }}
              />
            </label>
            <button type="submit" disabled={uploadBusy || onlineBusy}>
              {uploadBusy ? '正在整理…' : '导入并生成草稿'}
            </button>
          </form>
        </div>

        <form
          className={styles.onlineForm}
          aria-labelledby="online-entry-title"
          noValidate
          onSubmit={(event) => {
            void handleOnlineEntry(event);
          }}
        >
          <div className={styles.formHeading}>
            <div>
              <h2 id="online-entry-title">在线填写</h2>
            </div>
            <span>保存后先进入校对草稿</span>
          </div>
          <div className={styles.fieldGrid}>
            <label>
              公司
              <input name="company" maxLength={200} />
            </label>
            <label>
              岗位
              <input name="role" maxLength={200} />
            </label>
            <label>
              面试阶段
              <input name="stage" placeholder="例如：一面 / HR 面" maxLength={100} />
            </label>
            <label>
              面试日期
              <input name="occurredOn" type="date" />
            </label>
            <label>
              结果
              <input name="outcome" placeholder="例如：待定 / 通过" maxLength={100} />
            </label>
            <label>
              难度
              <input name="difficulty" placeholder="例如：中等" maxLength={100} />
            </label>
            <label className={styles.fullField}>
              标签
              <input name="tags" placeholder="Java、数据库、项目经历" maxLength={3_000} />
            </label>
          </div>
          <div className={styles.questionHeading}>
            <div>
              <h3>问题与回答</h3>
              <p>答案可以留空，系统不会替你补写。</p>
            </div>
            <button
              type="button"
              className="button-secondary"
              onClick={() => {
                const key = nextQuestionKey;
                setNextQuestionKey(key + 1);
                setQuestions([...questions, { key, question: '', answer: '', reflection: '' }]);
              }}
            >
              添加问题
            </button>
          </div>
          <ol className={styles.questionList}>
            {questions.map((question, index) => (
              <li key={question.key}>
                <div className={styles.questionNumber}>
                  <span>Q{String(index + 1).padStart(2, '0')}</span>
                  {questions.length > 1 ? (
                    <button
                      type="button"
                      className="button-ghost"
                      onClick={() => {
                        setQuestions(questions.filter((item) => item.key !== question.key));
                      }}
                    >
                      删除此题
                    </button>
                  ) : null}
                </div>
                <label>
                  问题
                  <textarea
                    className="resize-none"
                    rows={3}
                    maxLength={5_000}
                    value={question.question}
                    onChange={(event) => {
                      setQuestions(
                        questions.map((item) =>
                          item.key === question.key
                            ? { ...item, question: event.target.value }
                            : item,
                        ),
                      );
                    }}
                  />
                </label>
                <label>
                  当时的回答（可留空）
                  <textarea
                    className="resize-none"
                    rows={5}
                    maxLength={20_000}
                    value={question.answer}
                    onChange={(event) => {
                      setQuestions(
                        questions.map((item) =>
                          item.key === question.key
                            ? { ...item, answer: event.target.value }
                            : item,
                        ),
                      );
                    }}
                  />
                </label>
                <label>
                  复盘（可选）
                  <textarea
                    className="resize-none"
                    rows={3}
                    maxLength={10_000}
                    value={question.reflection}
                    onChange={(event) => {
                      setQuestions(
                        questions.map((item) =>
                          item.key === question.key
                            ? { ...item, reflection: event.target.value }
                            : item,
                        ),
                      );
                    }}
                  />
                </label>
              </li>
            ))}
          </ol>
          <label className={styles.notesField}>
            过程与备注
            <textarea className="resize-none" name="notes" rows={5} maxLength={20_000} />
          </label>
          <button type="submit" disabled={onlineBusy || uploadBusy}>
            {onlineBusy ? '正在整理…' : '生成校对草稿'}
          </button>
        </form>
      </section>

      {error ? (
        <p className="form-feedback error" role="alert" tabIndex={-1} ref={firstError}>
          {error}
        </p>
      ) : null}

      <section className={styles.archive} aria-labelledby="experience-archive-title">
        <div className={styles.archiveHeading}>
          <div>
            <h2 id="experience-archive-title">草稿与历史记录</h2>
          </div>
          <p>{documents.length} 份本地文档</p>
        </div>
        {documents.length === 0 ? (
          <div className="empty-state">
            <h3>还没有个人面经</h3>
            <p>下载模板、导入已有文档，或从上方在线填写第一段经历。</p>
          </div>
        ) : (
          <ol className={styles.archiveList}>
            {documents.map((item, index) => (
              <li key={item.document.id}>
                <a href={`/interview/experiences/${item.document.id}`}>
                  <span className={styles.archiveIndex}>{String(index + 1).padStart(2, '0')}</span>
                  <span className={styles.archiveCopy}>
                    <strong>
                      {item.company ?? '公司待补充'} · {item.role ?? '岗位待补充'}
                    </strong>
                    <small>
                      {item.stage ?? '阶段待补充'} · {dateLabel(item.occurredOn)} ·{' '}
                      {item.questionCount} 个问题
                    </small>
                  </span>
                  <span className={styles.archiveStatus}>
                    {item.document.status === 'accepted' ? '已入历史' : '待校对'}
                    {item.unansweredCount > 0 ? ` · ${String(item.unansweredCount)} 题未回答` : ''}
                  </span>
                </a>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
