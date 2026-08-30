'use client';

import type { ProjectDossierDetail } from '@jobhunter/application/web';
import { useRouter } from 'next/navigation.js';
import type { ReactElement } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { mutationHeaders } from '../../../../src/client/csrf.js';
import styles from './workbench.module.css';

export interface DrillTaskView {
  readonly status: string;
  readonly errorCategory: string | null;
  readonly errorSummary: string | null;
}

interface ApiEnvelope<T> {
  readonly data?: T;
  readonly error?: { readonly message?: string };
}

const dimensionLabels = {
  background_goal: '背景目标',
  personal_responsibility: '个人职责',
  architecture_design: '架构设计',
  key_implementation: '关键实现',
  technical_tradeoff: '技术取舍',
  data_metrics: '数据指标',
  incident_debugging: '故障调试',
  collaboration_delivery: '协作推进',
  security_quality: '安全质量',
  reflection_evolution: '反思演进',
} as const;

const coverageLabels = {
  unasked: '未提问',
  asked: '已提问',
  evidence_partial: '证据不足',
  evidence_sufficient: '证据充分',
  needs_clarification: '需要澄清',
} as const;

const sessionLabels = { active: '进行中', paused: '已暂停', completed: '已完成' } as const;

function taskFailure(task: DrillTaskView | undefined): string | null {
  if (task?.status !== 'failed' && task?.status !== 'cancelled') return null;
  if (task.errorCategory === 'invalid_config') {
    return 'AI 模型尚未配置。既有记录仍可查看；完成配置后可在任务页重试。';
  }
  if (task.status === 'cancelled') return '后台任务已取消，可以继续下一题。';
  return '后台处理失败。请在任务页查看诊断并重试。';
}

function formatTime(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function DrillWorkbench({
  detail,
  tasks,
}: Readonly<{
  detail: ProjectDossierDetail;
  tasks: Readonly<Record<string, DrillTaskView>>;
}>): ReactElement {
  const router = useRouter();
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const materialInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [answer, setAnswer] = useState('');
  const [answerToken, setAnswerToken] = useState(() => crypto.randomUUID());
  const [profileKey, setProfileKey] = useState<'resume-only' | 'docs-grounded'>('resume-only');
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<readonly string[]>([]);
  const [deleteImpact, setDeleteImpact] = useState<{
    readonly impactHash: string;
    readonly counts: Readonly<Record<string, number>>;
  } | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');

  const session = useMemo(
    () =>
      detail.sessionRecords.find((item) => item.status !== 'completed') ??
      detail.sessionRecords.toSorted((left, right) => right.createdAt - left.createdAt)[0] ??
      null,
    [detail.sessionRecords],
  );
  const currentMaterials = useMemo(() => {
    const latest = new Map<string, (typeof detail.materials)[number]>();
    for (const material of detail.materials) {
      const current = latest.get(material.fileId);
      if (!current || current.versionNo < material.versionNo) latest.set(material.fileId, material);
    }
    return [...latest.values()].toSorted((left, right) =>
      left.fileName.localeCompare(right.fileName),
    );
  }, [detail.materials]);
  const sessionTurns = session ? detail.turns.filter((turn) => turn.sessionId === session.id) : [];
  const latestTurn = sessionTurns.toSorted((left, right) => right.turnNo - left.turnNo)[0] ?? null;
  const currentTurn = session?.status === 'completed' ? null : latestTurn;
  const historyTurns =
    session?.status === 'completed'
      ? sessionTurns
      : sessionTurns.filter((turn) => turn.id !== currentTurn?.id);
  const currentTaskId =
    currentTurn?.status === 'question_pending'
      ? currentTurn.questionTaskId
      : currentTurn?.status === 'digest_pending'
        ? currentTurn.digestTaskId
        : null;
  const currentTask = currentTaskId ? tasks[currentTaskId] : undefined;
  const pending = currentTask?.status === 'pending' || currentTask?.status === 'running';
  const hasPendingTurn = currentTurn
    ? ['question_pending', 'digest_pending'].includes(currentTurn.status)
    : false;
  const shouldPoll = hasPendingTurn && (!currentTask || pending);

  useEffect(() => {
    if (!shouldPoll) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, 3_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [router, shouldPoll]);

  const mutate = async <T,>(
    key: string,
    url: string,
    body?: Readonly<Record<string, unknown>>,
  ): Promise<T> => {
    setBusy(key);
    setFeedback(null);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: await mutationHeaders(),
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const result = (await response.json()) as ApiEnvelope<T>;
      if (!response.ok || result.data === undefined) {
        throw new Error(result.error?.message ?? '操作失败，请稍后重试。');
      }
      return result.data;
    } finally {
      setBusy(null);
    }
  };

  const startSession = async (): Promise<void> => {
    try {
      await mutate('session', `/api/interview/projects/${detail.dossier.id}/sessions`, {
        profileKey,
        materialFileIds: profileKey === 'docs-grounded' ? selectedMaterialIds : [],
      });
      setFeedback('新一轮拷打已建立，可以生成第一题。');
      router.refresh();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : '无法开始拷打。');
    }
  };

  const uploadMaterials = async (): Promise<void> => {
    const files = [...(materialInput.current?.files ?? [])];
    if (files.length < 1) return;
    if (files.some((file) => file.size < 1 || file.size > 512 * 1024)) {
      setFeedback('每份项目资料必须非空且不超过 512 KiB。');
      return;
    }
    setBusy('materials');
    setFeedback(null);
    try {
      const failures: string[] = [];
      let succeeded = 0;
      for (const file of files) {
        const form = new FormData();
        form.append('files', file);
        const response = await fetch(`/api/interview/projects/${detail.dossier.id}/materials`, {
          method: 'POST',
          headers: await mutationHeaders(false),
          body: form,
        });
        const result = (await response.json()) as ApiEnvelope<readonly unknown[]>;
        if (!response.ok || !result.data) {
          failures.push(`${file.name}：${result.error?.message ?? '登记失败'}`);
        } else {
          succeeded += result.data.length;
        }
      }
      if (succeeded > 0) {
        if (materialInput.current) materialInput.current.value = '';
        router.refresh();
      }
      setFeedback(
        failures.length === 0
          ? `已登记 ${String(succeeded)} 份项目资料。`
          : `已登记 ${String(succeeded)} 份；${failures.join('；')}`,
      );
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : '项目资料上传失败。');
    } finally {
      setBusy(null);
    }
  };

  const materialEvidence = (
    turn: (typeof detail.turns)[number],
  ): {
    readonly material: (typeof detail.materials)[number];
    readonly chunk: (typeof detail.materials)[number]['chunks'][number];
  }[] =>
    turn.evidenceRefs.flatMap((reference) => {
      if (reference.kind !== 'project_material') return [];
      for (const material of detail.materials) {
        const chunk = material.chunks.find((candidate) => candidate.id === reference.id);
        if (chunk) return [{ material, chunk }];
      }
      return [];
    });

  const requestQuestion = async (): Promise<void> => {
    if (!session) return;
    try {
      const result = await mutate<{ readonly taskId: string }>(
        'question',
        `/api/interview/sessions/${session.id}/questions`,
      );
      setFeedback(`问题生成任务已创建：${result.taskId}`);
      router.refresh();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : '无法生成下一题。');
    }
  };

  const submitAnswer = async (): Promise<void> => {
    if (!session || !currentTurn || !answer.trim()) return;
    try {
      const result = await mutate<{ readonly taskId: string }>(
        'answer',
        `/api/interview/turns/${currentTurn.id}/answers`,
        { sessionId: session.id, answer, idempotencyToken: answerToken },
      );
      setFeedback(`回答已原样保存，分析任务已创建：${result.taskId}`);
      setAnswer('');
      setAnswerToken(crypto.randomUUID());
      router.refresh();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : '无法保存回答。');
    }
  };

  const simpleAction = async (key: string, url: string, message: string): Promise<void> => {
    try {
      await mutate(key, url);
      setFeedback(message);
      router.refresh();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : '操作失败，请稍后重试。');
    }
  };

  const transition = async (action: 'pause' | 'resume' | 'complete'): Promise<void> => {
    if (!session) return;
    try {
      await mutate('state', `/api/interview/sessions/${session.id}/state`, { action });
      setFeedback(
        action === 'pause'
          ? '会话已暂停。'
          : action === 'resume'
            ? '会话已继续。'
            : '本轮会话已完成。',
      );
      router.refresh();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : '无法更新会话状态。');
    }
  };

  const previewDeletion = async (): Promise<void> => {
    setBusy('delete-preview');
    setFeedback(null);
    try {
      const response = await fetch(`/api/interview/projects/${detail.dossier.id}/deletion`, {
        cache: 'no-store',
      });
      const body = (await response.json()) as ApiEnvelope<{
        readonly impactHash: string;
        readonly counts: Readonly<Record<string, number>>;
      }>;
      if (!response.ok || !body.data) {
        throw new Error(body.error?.message ?? '无法生成删除预览。');
      }
      setDeleteImpact(body.data);
      deleteDialog.current?.showModal();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : '无法生成删除预览。');
    } finally {
      setBusy(null);
    }
  };

  const confirmDeletion = async (): Promise<void> => {
    if (!deleteImpact || deleteConfirmation !== 'DELETE') return;
    try {
      const result = await mutate<{ readonly pendingArtifactPurgeId: string | null }>(
        'delete-confirm',
        `/api/interview/projects/${detail.dossier.id}/deletion`,
        {
          expectedImpactHash: deleteImpact.impactHash,
          confirmation: deleteConfirmation,
        },
      );
      deleteDialog.current?.close();
      if (result.pendingArtifactPurgeId) {
        setFeedback('档案已删除，投影文件仍待后台清理。');
      }
      router.push('/interview');
      router.refresh();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : '无法删除准备档案。');
    }
  };

  const currentAnswers = currentTurn
    ? detail.answers
        .filter((item) => item.turnId === currentTurn.id)
        .toSorted((left, right) => right.revisionNo - left.revisionNo)
    : [];
  const failure = taskFailure(currentTask);

  return (
    <div className={styles.root} aria-busy={busy !== null || pending}>
      <section className={styles.snapshot} aria-labelledby="snapshot-title">
        <div>
          <h2 id="snapshot-title">{detail.snapshot.project.role ?? '项目经历'}</h2>
        </div>
        <div className={styles.snapshotFacts}>
          <span>{detail.sourceAvailable ? '来源简历可用' : '来源已分离 · 当前展示冻结快照'}</span>
          <span>
            {session?.profileKey === 'docs-grounded' ? '深档' : '浅档'} ·{' '}
            {session ? `${session.profileKey}@${session.profileVersion}` : '尚未开始'}
          </span>
          {detail.dossier.latestNotebookArtifactId ? (
            <a href={`/api/interview/projects/${detail.dossier.id}/notebook`}>下载 Markdown</a>
          ) : (
            <span>Markdown 正在准备</span>
          )}
        </div>
        {detail.snapshot.project.highlights.length ? (
          <ul>
            {detail.snapshot.project.highlights.map((highlight) => (
              <li key={highlight}>{highlight}</li>
            ))}
          </ul>
        ) : (
          <p className={styles.muted}>简历没有项目描述，首轮问题会先帮助补齐背景和职责。</p>
        )}
      </section>

      <section className={styles.materials} aria-labelledby="project-materials-title">
        <header>
          <div>
            <h2 id="project-materials-title">项目资料</h2>
          </div>
          <span>{currentMaterials.length} 个逻辑文件</span>
        </header>
        <p className={styles.muted}>
          只读取你在这里显式上传并在会话前勾选的 Markdown；不会扫描项目目录或源码。
        </p>
        <form
          className={styles.materialUpload}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void uploadMaterials();
          }}
        >
          <label htmlFor="project-material-files">上传 Markdown / MDX（单份不超过 512 KiB）</label>
          <input
            ref={materialInput}
            id="project-material-files"
            name="files"
            type="file"
            accept=".md,.mdx,text/markdown"
            multiple
            disabled={busy !== null}
          />
          <button type="submit" className="button-secondary" disabled={busy !== null}>
            {busy === 'materials' ? '正在登记…' : '登记资料版本'}
          </button>
        </form>
        {currentMaterials.length > 0 ? (
          <ul className={styles.materialList}>
            {currentMaterials.map((material) => (
              <li key={material.fileId}>
                <strong>{material.fileName}</strong>
                <span>v{material.versionNo}</span>
                <span>{material.chunks.length} 个标题分块</span>
                <code>{material.contentHash.slice(0, 12)}</code>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.muted}>尚未登记资料；浅档仍可正常使用。</p>
        )}
      </section>

      <div className={styles.workspace}>
        <section className={styles.drill} aria-labelledby="current-question-title">
          <header className={styles.drillHeader}>
            <div>
              <h2 id="current-question-title">当前拷打</h2>
            </div>
            {session ? (
              <span className={styles.sessionStatus}>{sessionLabels[session.status]}</span>
            ) : null}
          </header>

          {!session || session.status === 'completed' ? (
            <div className={styles.nextStep}>
              <span className={styles.decisionCursor} aria-hidden="true" />
              <div>
                <h3>{session ? '开始新一轮准备' : '建立第一轮会话'}</h3>
                <p>每次只推进一个问题；可以随时暂停，历史记录不会被覆盖。</p>
                <div className={styles.profileChooser}>
                  <label htmlFor="drill-profile">拷打档位</label>
                  <select
                    id="drill-profile"
                    value={profileKey}
                    disabled={busy !== null}
                    onChange={(event) => {
                      setProfileKey(event.currentTarget.value as typeof profileKey);
                    }}
                  >
                    <option value="resume-only">浅档 · 只用简历项目</option>
                    <option value="docs-grounded" disabled={currentMaterials.length === 0}>
                      深档 · 简历 + 选中 Markdown
                    </option>
                  </select>
                  {profileKey === 'docs-grounded' ? (
                    <fieldset>
                      <legend>本轮冻结资料</legend>
                      {currentMaterials.map((material) => (
                        <label key={material.fileId}>
                          <input
                            type="checkbox"
                            checked={selectedMaterialIds.includes(material.fileId)}
                            onChange={(event) => {
                              const checked = event.currentTarget.checked;
                              setSelectedMaterialIds((current) =>
                                checked
                                  ? [...current, material.fileId]
                                  : current.filter((id) => id !== material.fileId),
                              );
                            }}
                          />
                          {material.fileName} · v{material.versionNo}
                        </label>
                      ))}
                    </fieldset>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                disabled={
                  busy !== null ||
                  (profileKey === 'docs-grounded' && selectedMaterialIds.length === 0)
                }
                onClick={() => void startSession()}
              >
                {busy === 'session' ? '正在建立…' : '开始拷打'}
              </button>
            </div>
          ) : session.status === 'paused' ? (
            <div className={styles.nextStep}>
              <span className={styles.decisionCursor} aria-hidden="true" />
              <div>
                <h3>本轮已暂停</h3>
                <p>继续后仍从当前项目上下文接着提问。</p>
              </div>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void transition('resume')}
              >
                继续会话
              </button>
            </div>
          ) : currentTurn?.status === 'ready' ? (
            <div>
              <div className={styles.nextStep}>
                <span className={styles.decisionCursor} aria-hidden="true" />
                <div>
                  <h3>上一题已归档</h3>
                  <p>可以继续下一题，也可以追加一版回答修订；旧版本不会被覆盖。</p>
                </div>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void requestQuestion()}
                >
                  {busy === 'question' ? '正在创建…' : '生成下一题'}
                </button>
              </div>
              <details className={styles.revisionPanel}>
                <summary>补充或修订上一题回答</summary>
                <h3>{currentTurn.question}</h3>
                {currentAnswers[0] ? (
                  <p className={styles.answerText}>{currentAnswers[0].answer}</p>
                ) : null}
                <form
                  className={styles.answerForm}
                  noValidate
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submitAnswer();
                  }}
                >
                  <label htmlFor="drill-answer-revision">新的完整回答版本</label>
                  <textarea
                    className="resize-none"
                    id="drill-answer-revision"
                    rows={7}
                    maxLength={20_000}
                    value={answer}
                    disabled={busy !== null}
                    onChange={(event) => {
                      setAnswer(event.currentTarget.value);
                    }}
                    placeholder="提交完整的新版本；系统会保留上一个版本。"
                  />
                  <div className={styles.answerActions}>
                    <span>{answer.length.toLocaleString('zh-CN')} / 20,000</span>
                    <button
                      className="button-secondary"
                      type="submit"
                      disabled={busy !== null || !answer.trim()}
                    >
                      {busy === 'answer' ? '正在保存…' : '保存回答修订'}
                    </button>
                  </div>
                </form>
              </details>
            </div>
          ) : !currentTurn || ['skipped', 'cancelled'].includes(currentTurn.status) ? (
            <div className={styles.nextStep}>
              <span className={styles.decisionCursor} aria-hidden="true" />
              <div>
                <h3>{currentTurn ? '上一题已归档' : '从简历描述开始'}</h3>
                <p>下一题会结合冻结快照、已有回答和覆盖缺口生成。</p>
              </div>
              <button type="button" disabled={busy !== null} onClick={() => void requestQuestion()}>
                {busy === 'question' ? '正在创建…' : currentTurn ? '生成下一题' : '生成第一题'}
              </button>
            </div>
          ) : currentTurn.status === 'question_pending' ? (
            <div className={styles.pendingBlock}>
              <span className={styles.decisionCursor} aria-hidden="true" />
              <div>
                <h3>正在生成问题</h3>
                <p>Worker 会根据当前项目事实生成一个主问题，页面将自动刷新。</p>
                {failure ? (
                  <p className={styles.failure} role="alert">
                    {failure}
                  </p>
                ) : null}
                {currentTaskId ? <a href={`/tasks?search=${currentTaskId}`}>查看任务状态</a> : null}
              </div>
              <button
                type="button"
                className="button-muted"
                disabled={busy !== null}
                onClick={() =>
                  void simpleAction(
                    'cancel',
                    `/api/interview/turns/${currentTurn.id}/cancel`,
                    '问题生成已取消。',
                  )
                }
              >
                取消
              </button>
            </div>
          ) : currentTurn.status === 'digest_pending' ? (
            <div className={styles.pendingBlock}>
              <span className={styles.decisionCursor} aria-hidden="true" />
              <div>
                <h3>回答已保存，正在整理证据</h3>
                <p>系统只抽取事实、歧义与覆盖变化，不会改写你的原回答。</p>
                {failure ? (
                  <p className={styles.failure} role="alert">
                    {failure}
                  </p>
                ) : null}
                {currentTaskId ? <a href={`/tasks?search=${currentTaskId}`}>查看任务状态</a> : null}
              </div>
              <button
                type="button"
                className="button-muted"
                disabled={busy !== null}
                onClick={() =>
                  void simpleAction(
                    'cancel',
                    `/api/interview/turns/${currentTurn.id}/cancel`,
                    '回答分析已取消，原回答仍保留。',
                  )
                }
              >
                取消分析
              </button>
            </div>
          ) : (
            <article className={styles.question}>
              <div className={styles.questionNumber}>
                Q{String(currentTurn.turnNo).padStart(2, '0')}
              </div>
              <div className={styles.questionBody}>
                <p className={styles.dimension}>
                  {currentTurn.primaryDimension
                    ? dimensionLabels[currentTurn.primaryDimension]
                    : '项目事实'}
                </p>
                <h3>{currentTurn.question}</h3>
                {currentTurn.intent ? <p className={styles.intent}>{currentTurn.intent}</p> : null}
                {materialEvidence(currentTurn).length > 0 ? (
                  <div className={styles.evidence}>
                    <strong>提问依据</strong>
                    <ul>
                      {materialEvidence(currentTurn).map(({ material, chunk }) => (
                        <li key={chunk.id}>
                          {material.fileName}
                          {chunk.heading ? ` · ${chunk.heading}` : ''}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <div className={styles.guidance}>
                  <strong>回答时建议覆盖</strong>
                  <ul>
                    {currentTurn.guidanceSlots.map((slot) => (
                      <li key={slot}>{slot}</li>
                    ))}
                  </ul>
                </div>
                {currentAnswers.length ? (
                  <details className={styles.latestAnswer}>
                    <summary>查看已保存的 {currentAnswers.length} 版回答</summary>
                    <p>{currentAnswers[0]?.answer}</p>
                  </details>
                ) : null}
                <form
                  className={styles.answerForm}
                  noValidate
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submitAnswer();
                  }}
                >
                  <label htmlFor="drill-answer">
                    {currentAnswers.length ? '追加一版回答修订' : '你的回答'}
                  </label>
                  <textarea
                    className="resize-none"
                    id="drill-answer"
                    rows={8}
                    maxLength={20_000}
                    value={answer}
                    disabled={busy !== null}
                    aria-invalid={answer.length > 0 && !answer.trim()}
                    onChange={(event) => {
                      setAnswer(event.currentTarget.value);
                    }}
                    placeholder="写下你实际做过什么、为什么这样做、结果如何。系统不会替你补事实。"
                  />
                  <div className={styles.answerActions}>
                    <span>{answer.length.toLocaleString('zh-CN')} / 20,000</span>
                    {!currentAnswers.length ? (
                      <button
                        type="button"
                        className="button-muted"
                        disabled={busy !== null}
                        onClick={() =>
                          void simpleAction(
                            'skip',
                            `/api/interview/turns/${currentTurn.id}/skip`,
                            '本题已跳过。',
                          )
                        }
                      >
                        跳过本题
                      </button>
                    ) : null}
                    <button type="submit" disabled={busy !== null || !answer.trim()}>
                      {busy === 'answer'
                        ? '正在保存…'
                        : currentAnswers.length
                          ? '保存修订'
                          : '保存并分析'}
                    </button>
                  </div>
                </form>
              </div>
            </article>
          )}

          {feedback ? (
            <p
              className={
                feedback.includes('失败') || feedback.includes('无法')
                  ? 'form-feedback error'
                  : 'form-feedback success'
              }
              role="status"
            >
              {feedback}
            </p>
          ) : null}

          {session && session.status !== 'completed' ? (
            <div className={styles.sessionActions}>
              <span>会话控制</span>
              {session.status === 'active' ? (
                <button
                  type="button"
                  className="button-muted"
                  disabled={busy !== null || hasPendingTurn}
                  onClick={() => void transition('pause')}
                >
                  暂停
                </button>
              ) : null}
              <button
                type="button"
                className="button-muted"
                disabled={busy !== null || hasPendingTurn}
                onClick={() => void transition('complete')}
              >
                完成本轮
              </button>
            </div>
          ) : null}
        </section>

        <aside className={styles.coverage} aria-labelledby="coverage-title">
          <header>
            <h2 id="coverage-title">准备覆盖</h2>
            <p>只记录证据状态，不计算总分。</p>
          </header>
          {session ? (
            <dl>
              {detail.coverage
                .filter((item) => item.sessionId === session.id)
                .map((item) => (
                  <div key={item.dimension} data-status={item.status}>
                    <dt>{dimensionLabels[item.dimension]}</dt>
                    <dd>{coverageLabels[item.status]}</dd>
                  </div>
                ))}
            </dl>
          ) : (
            <p className={styles.muted}>开始会话后建立十维覆盖台账。</p>
          )}
        </aside>
      </div>

      <section className={styles.history} aria-labelledby="history-title">
        <header>
          <div>
            <h2 id="history-title">问答记录</h2>
          </div>
          <span>{historyTurns.length} 题已归档</span>
        </header>
        {historyTurns.length === 0 ? (
          <p className={styles.muted}>完成第一题后，问题、回答修订和推导会按题序保存在这里。</p>
        ) : (
          <ol>
            {historyTurns
              .toSorted((left, right) => right.turnNo - left.turnNo)
              .map((turn) => {
                const answers = detail.answers
                  .filter((item) => item.turnId === turn.id)
                  .toSorted((left, right) => left.revisionNo - right.revisionNo);
                return (
                  <li key={turn.id}>
                    <div className={styles.historyMarker}>
                      {String(turn.turnNo).padStart(2, '0')}
                    </div>
                    <article>
                      <header>
                        <span>
                          {turn.primaryDimension
                            ? dimensionLabels[turn.primaryDimension]
                            : turn.status === 'skipped'
                              ? '已跳过'
                              : '未生成'}
                        </span>
                        <time dateTime={new Date(turn.createdAt).toISOString()}>
                          {formatTime(turn.createdAt)}
                        </time>
                      </header>
                      <h3>{turn.question ?? '本题在生成完成前被取消'}</h3>
                      {materialEvidence(turn).length > 0 ? (
                        <ul className={styles.historyEvidence} aria-label="提问资料依据">
                          {materialEvidence(turn).map(({ material, chunk }) => (
                            <li key={chunk.id}>
                              {material.fileName}
                              {chunk.heading ? ` · ${chunk.heading}` : ''}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {answers.map((item) => {
                        const knowledge = detail.knowledgeItems.filter(
                          (candidate) => candidate.sourceAnswerRevisionId === item.id,
                        );
                        return (
                          <details key={item.id} open={item.revisionNo === answers.length}>
                            <summary>回答版本 {item.revisionNo}</summary>
                            <p className={styles.answerText}>{item.answer}</p>
                            {knowledge.length ? (
                              <ul className={styles.knowledge}>
                                {knowledge.map((candidate) => (
                                  <li key={candidate.id}>
                                    <span>{candidate.kind}</span>
                                    {candidate.statement}
                                    {candidate.status === 'superseded' ? (
                                      <small>已被新修订取代</small>
                                    ) : null}
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </details>
                        );
                      })}
                    </article>
                  </li>
                );
              })}
          </ol>
        )}
      </section>

      <section className={styles.dangerZone} aria-labelledby="delete-dossier-title">
        <div>
          <h2 id="delete-dossier-title">删除准备档案</h2>
          <p>
            删除会清除该项目的会话、回答、推导、资料逻辑文件和未共享物理内容，不会删除个人资料或简历文件。
          </p>
        </div>
        <button
          type="button"
          className="button-danger"
          disabled={busy !== null}
          onClick={() => void previewDeletion()}
        >
          {busy === 'delete-preview' ? '正在检查…' : '预览删除影响'}
        </button>
      </section>

      <dialog
        ref={deleteDialog}
        className={styles.deleteDialog}
        aria-labelledby="delete-dialog-title"
      >
        <form method="dialog" noValidate>
          <header>
            <h2 id="delete-dialog-title">确认删除准备档案</h2>
          </header>
          {deleteImpact ? (
            <ul>
              <li>{deleteImpact.counts.sessions ?? 0} 轮会话</li>
              <li>{deleteImpact.counts.turns ?? 0} 个问题</li>
              <li>{deleteImpact.counts.answerRevisions ?? 0} 版回答</li>
              <li>{deleteImpact.counts.knowledgeItems ?? 0} 条推导记录</li>
              <li>{deleteImpact.counts.materialFiles ?? 0} 个项目资料逻辑文件</li>
              <li>{deleteImpact.counts.materialArtifacts ?? 0} 个独占物理文件</li>
            </ul>
          ) : null}
          <label htmlFor="delete-confirmation">输入 DELETE 进行二次确认</label>
          <input
            id="delete-confirmation"
            value={deleteConfirmation}
            onChange={(event) => {
              setDeleteConfirmation(event.currentTarget.value);
            }}
          />
          <footer>
            <button type="submit" className="button-secondary">
              取消
            </button>
            <button
              type="button"
              className="button-danger"
              disabled={busy !== null || deleteConfirmation !== 'DELETE'}
              onClick={() => void confirmDeletion()}
            >
              {busy === 'delete-confirm' ? '正在删除…' : '永久删除'}
            </button>
          </footer>
        </form>
      </dialog>
    </div>
  );
}
