'use client';

import type { ExperienceResearchDetail } from '@jobhunter/application/web';
import { useRouter } from 'next/navigation.js';
import type { ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';
import { mutationHeaders } from '../../../../src/client/csrf.js';
import { SelectField } from '../../../components/select-field.js';
import { useToast } from '../../../components/toast-provider.js';
import { CommunityExperienceRecord } from '../community-experience-record.js';
import styles from '../research.module.css';

export interface ResearchTaskView {
  readonly id: string;
  readonly status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  readonly errorCategory: string | null;
}

interface ApiEnvelope<T> {
  readonly data?: T;
  readonly error?: { readonly code?: string; readonly message?: string };
}

interface AcceptedTask {
  readonly taskId: string;
  readonly status: ResearchTaskView['status'];
  readonly deduplicated: boolean;
  readonly statusUrl: string;
}

interface CancelledTask {
  readonly kind: 'task';
  readonly task: { readonly status: ResearchTaskView['status'] };
}

const requestStateLabels = {
  ready: '待执行',
  needs_review: '待审核',
  completed: '已完成',
} as const;

const taskStateLabels = {
  pending: '等待 Worker',
  running: 'Codex 执行中',
  succeeded: '任务已完成',
  failed: '任务失败',
  cancelled: '任务已取消',
} as const;

const maximumBundleBytes = 2 * 1024 * 1024;
const browserPromptVersion = 'community-research-prompt@v4';
type ResearchExecutorKey = 'codex-local' | 'browser-assisted-codex';

function defaultExecutor(promptVersion: string): ResearchExecutorKey {
  return promptVersion === browserPromptVersion ? 'browser-assisted-codex' : 'codex-local';
}

function taskFailure(task: ResearchTaskView | null): string | null {
  if (task?.status === 'cancelled') return '研究任务已取消。可以重新发布，或手动导入结果。';
  if (task?.status !== 'failed') return null;
  if (task.errorCategory === 'invalid_config') {
    return '本地研究执行器尚未配置。仍可复制 Prompt 交给其他 Agent，并手动导入结果。';
  }
  if (task.errorCategory === 'validation_failed') {
    return 'Agent 返回的内容未通过 Schema 校验。请在任务页查看诊断，并按当前 Schema 重新生成。';
  }
  return '研究任务未完成。请在任务页查看诊断后重试。';
}

function byteLabel(bytes: number): string {
  return bytes < 1024 ? `${String(bytes)} B` : `${(bytes / 1024).toFixed(1)} KiB`;
}

export function ResearchWorkbench({
  detail,
  task,
}: Readonly<{
  detail: ExperienceResearchDetail;
  task: ResearchTaskView | null;
}>): ReactElement {
  const router = useRouter();
  const { showToast } = useToast();
  const feedbackRef = useRef<HTMLParagraphElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [current, setCurrent] = useState(detail);
  const [currentTask, setCurrentTask] = useState(task);
  const [executorKey, setExecutorKey] = useState<ResearchExecutorKey>(() =>
    defaultExecutor(detail.request.promptVersion),
  );
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackError, setFeedbackError] = useState(false);

  useEffect(() => {
    setCurrent(detail);
    setCurrentTask(task);
    setExecutorKey(defaultExecutor(detail.request.promptVersion));
  }, [detail, task]);

  const taskPending = currentTask?.status === 'pending' || currentTask?.status === 'running';

  useEffect(() => {
    if (!taskPending) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, 3_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [router, taskPending]);

  const report = (message: string, isError = false): void => {
    if (!isError) {
      setFeedback(null);
      setFeedbackError(false);
      showToast(message);
      return;
    }
    // 错误保留在工作台内，确保较长的诊断信息不会随 Toast 超时消失。
    setFeedback(message);
    setFeedbackError(true);
    queueMicrotask(() => feedbackRef.current?.focus());
  };

  const copyAsset = async (kind: 'prompt' | 'schema'): Promise<void> => {
    setBusy(`copy-${kind}`);
    setFeedback(null);
    try {
      const response = await fetch(`/api/interview/research/${current.request.id}/${kind}`, {
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('无法读取交接材料。');
      await navigator.clipboard.writeText(await response.text());
      report(kind === 'prompt' ? 'Prompt 已复制到剪贴板。' : 'Schema 已复制到剪贴板。');
    } catch (caught) {
      report(caught instanceof Error ? caught.message : '无法复制交接材料。', true);
    } finally {
      setBusy(null);
    }
  };

  const execute = async (): Promise<void> => {
    setBusy('execute');
    setFeedback(null);
    try {
      const response = await fetch(`/api/interview/research/${current.request.id}/executions`, {
        method: 'POST',
        headers: await mutationHeaders(),
        body: JSON.stringify({
          executorKey,
          idempotencyToken: crypto.randomUUID(),
        }),
      });
      const result = (await response.json()) as ApiEnvelope<AcceptedTask>;
      if (!response.ok || !result.data) {
        throw new Error(result.error?.message ?? '无法发布 Codex 研究任务。');
      }
      setCurrentTask({
        id: result.data.taskId,
        status: result.data.status,
        errorCategory: null,
      });
      report(
        result.data.deduplicated
          ? '相同研究任务已在队列中，将继续等待结果。'
          : executorKey === 'browser-assisted-codex'
            ? '研究任务已发布。Worker 将匿名采集公开网页，再交给无网络 Codex 筛选；离开此页不会中断。'
            : '研究任务已发布给本机 Codex，仅使用原生网页搜索；离开此页不会中断。',
      );
      router.refresh();
    } catch (caught) {
      report(caught instanceof Error ? caught.message : '无法发布 Codex 研究任务。', true);
    } finally {
      setBusy(null);
    }
  };

  const cancelExecution = async (): Promise<void> => {
    if (!currentTask || !taskPending) return;
    setBusy('cancel-task');
    setFeedback(null);
    try {
      const response = await fetch(`/api/tasks/${currentTask.id}/cancel`, {
        method: 'POST',
        headers: await mutationHeaders(),
        body: JSON.stringify({}),
      });
      const result = (await response.json()) as ApiEnvelope<CancelledTask>;
      if (!response.ok || !result.data) {
        throw new Error(result.error?.message ?? '无法取消研究任务。');
      }
      setCurrentTask({ ...currentTask, status: result.data.task.status });
      report(
        result.data.task.status === 'cancelled'
          ? '研究任务已取消，可以重新发布。'
          : '取消请求已提交，Worker 正在停止 Codex。',
      );
      router.refresh();
    } catch (caught) {
      report(caught instanceof Error ? caught.message : '无法取消研究任务。', true);
    } finally {
      setBusy(null);
    }
  };

  const chooseFile = (file: File | null): void => {
    setFeedback(null);
    if (!file) {
      setSelectedFile(null);
      return;
    }
    if (!file.name.toLowerCase().endsWith('.json')) {
      setSelectedFile(null);
      report('请选择 JSON 研究结果文件。', true);
      return;
    }
    if (file.size < 1 || file.size > maximumBundleBytes) {
      setSelectedFile(null);
      report('研究结果必须大于 0 且不超过 2 MiB。', true);
      return;
    }
    setSelectedFile(file);
  };

  const importBundle = async (): Promise<void> => {
    if (!selectedFile) {
      report('请先选择一份 JSON 研究结果。', true);
      queueMicrotask(() => fileInput.current?.focus());
      return;
    }
    setBusy('import');
    setFeedback(null);
    try {
      const form = new FormData();
      form.set('file', selectedFile);
      form.set('expectedRevision', String(current.request.revision));
      const response = await fetch(`/api/interview/research/${current.request.id}/bundles`, {
        method: 'POST',
        headers: await mutationHeaders(false),
        body: form,
      });
      const result = (await response.json()) as ApiEnvelope<ExperienceResearchDetail>;
      if (!response.ok || !result.data) {
        throw new Error(result.error?.message ?? '无法导入研究结果。');
      }
      setCurrent(result.data);
      setSelectedFile(null);
      if (fileInput.current) fileInput.current.value = '';
      report(`已导入 ${String(result.data.experiences.length)} 份候选面经，请逐条核对。`);
      router.refresh();
    } catch (caught) {
      report(caught instanceof Error ? caught.message : '无法导入研究结果。', true);
    } finally {
      setBusy(null);
    }
  };

  const review = async (experienceId: string, decision: 'accept' | 'reject'): Promise<void> => {
    setBusy(`${decision}-${experienceId}`);
    setFeedback(null);
    try {
      const response = await fetch(`/api/interview/research/${current.request.id}/review`, {
        method: 'POST',
        headers: await mutationHeaders(),
        body: JSON.stringify({
          experienceId,
          expectedRevision: current.request.revision,
          decision,
        }),
      });
      const result = (await response.json()) as ApiEnvelope<ExperienceResearchDetail>;
      if (!response.ok || !result.data) {
        throw new Error(result.error?.message ?? '无法保存审核决定。');
      }
      setCurrent(result.data);
      report(decision === 'accept' ? '候选已进入网友面经。' : '候选已拒绝，不会进入网友面经。');
      router.refresh();
    } catch (caught) {
      report(caught instanceof Error ? caught.message : '无法保存审核决定。', true);
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  const pendingCandidates = current.experiences.filter(
    (experience) => experience.reviewStatus === 'needs_review',
  );
  const acceptedCandidates = current.experiences.filter(
    (experience) => experience.reviewStatus === 'accepted',
  );
  const rejectedCount = current.experiences.filter(
    (experience) => experience.reviewStatus === 'rejected',
  ).length;
  const replacementBlocked =
    acceptedCandidates.length > 0 || (current.request.bundleFileVersionNo ?? 0) >= 5;
  const allCandidatesRejected =
    current.experiences.length > 0 &&
    current.experiences.every((experience) => experience.reviewStatus === 'rejected');
  const canExecute =
    current.request.state === 'ready' ||
    (current.request.state === 'completed' && allCandidatesRejected && !replacementBlocked);
  const failure = taskFailure(currentTask);
  const browserCompatible = current.request.promptVersion === browserPromptVersion;
  const executorOptions = browserCompatible
    ? [
        { value: 'browser-assisted-codex', label: '受限浏览器增强（推荐）' },
        { value: 'codex-local', label: '仅原生网页搜索（兼容）' },
      ]
    : [{ value: 'codex-local', label: '仅原生网页搜索' }];

  return (
    <div className={styles.root} aria-busy={busy !== null || taskPending}>
      <section className={styles.briefSnapshot} aria-labelledby="brief-snapshot-title">
        <div>
          <h2 id="brief-snapshot-title">研究约束</h2>
        </div>
        <div className={styles.summaryStates}>
          <span
            className={`status status-${current.request.state === 'ready' ? 'pending' : current.request.state === 'needs_review' ? 'running' : 'succeeded'}`}
          >
            请求：{requestStateLabels[current.request.state]}
          </span>
          {currentTask ? (
            <span className={`status status-${currentTask.status}`}>
              任务：{taskStateLabels[currentTask.status]}
            </span>
          ) : null}
        </div>
        <dl>
          <div>
            <dt>岗位</dt>
            <dd>{current.request.brief.targetRoles.join('、')}</dd>
          </div>
          <div>
            <dt>公司 / 地点</dt>
            <dd>
              {[...current.request.brief.companies, ...current.request.brief.locations].join(
                '、',
              ) || '不限'}
            </dd>
          </div>
          <div>
            <dt>规模</dt>
            <dd>
              最多 {current.request.brief.maxSources} 个来源 · 每来源最多{' '}
              {current.request.brief.maxQuestionsPerSource} 题
            </dd>
          </div>
          <div>
            <dt>版本</dt>
            <dd>
              {current.request.promptVersion} · {current.request.schemaVersion}
            </dd>
          </div>
        </dl>
      </section>

      <div className={styles.handoffGrid}>
        <section className={styles.handoff} aria-labelledby="handoff-title">
          <header>
            <div>
              <h2 id="handoff-title">把调研交给外部 Agent</h2>
            </div>
            <span>公开网页 · 无简历上下文</span>
          </header>
          <p>
            Prompt 说明研究目标，Schema 固定返回格式。你可以直接发布给本机
            Codex，也可以把两份文件交给其他工具。
          </p>
          <div className={styles.assetRows}>
            <div>
              <div>
                <strong>Research Prompt</strong>
                <small>{current.request.promptVersion}</small>
              </div>
              <div className={styles.inlineActions}>
                <button
                  type="button"
                  className="button-secondary"
                  disabled={busy !== null}
                  onClick={() => void copyAsset('prompt')}
                >
                  {busy === 'copy-prompt' ? '复制中…' : '复制 Prompt'}
                </button>
                <a
                  className="button-secondary"
                  href={`/api/interview/research/${current.request.id}/prompt`}
                >
                  下载 .md
                </a>
              </div>
            </div>
            <div>
              <div>
                <strong>Output Schema</strong>
                <small>{current.request.schemaVersion}</small>
              </div>
              <div className={styles.inlineActions}>
                <button
                  type="button"
                  className="button-secondary"
                  disabled={busy !== null}
                  onClick={() => void copyAsset('schema')}
                >
                  {busy === 'copy-schema' ? '复制中…' : '复制 Schema'}
                </button>
                <a
                  className="button-secondary"
                  href={`/api/interview/research/${current.request.id}/schema`}
                >
                  下载 .json
                </a>
              </div>
            </div>
          </div>
          <div className={styles.executionBar}>
            <span className={styles.decisionCursor} aria-hidden="true" />
            <div className={styles.executionChoice}>
              <div>
                <strong>本机 Codex</strong>
                <p>
                  {executorKey === 'browser-assisted-codex'
                    ? 'Worker 使用匿名隔离浏览器采集公开正文，Codex 仅离线筛选问题。'
                    : browserCompatible
                      ? '只使用 Codex 原生网页搜索，适合作为兼容路径。'
                      : '该请求使用旧版 Prompt，只能使用原生网页搜索或手工导包。'}
                </p>
              </div>
              <div className={styles.executorSelector}>
                <span>执行方式</span>
                <SelectField
                  name="researchExecutor"
                  label="研究执行方式"
                  options={executorOptions}
                  value={executorKey}
                  disabled={busy !== null || taskPending || !canExecute}
                  onValueChange={(value) => {
                    if (value === 'codex-local' || value === 'browser-assisted-codex') {
                      setExecutorKey(value);
                    }
                  }}
                />
              </div>
            </div>
            <button
              type="button"
              disabled={busy !== null || taskPending || !canExecute}
              onClick={() => void execute()}
            >
              {busy === 'execute' ? '发布中…' : taskPending ? '任务执行中…' : '发布研究任务'}
            </button>
          </div>
          {currentTask ? (
            <div className={styles.taskLine}>
              <span className={`status status-${currentTask.status}`}>
                {taskStateLabels[currentTask.status]}
              </span>
              <code>{currentTask.id}</code>
              <a href="/tasks?type=interview.experience-research.execute">查看任务诊断</a>
              {taskPending ? (
                <button
                  type="button"
                  className="button-link"
                  disabled={busy !== null}
                  onClick={() => void cancelExecution()}
                >
                  {busy === 'cancel-task' ? '取消中…' : '取消任务'}
                </button>
              ) : null}
            </div>
          ) : null}
          {failure ? <p className="form-feedback error">{failure}</p> : null}
        </section>

        <section className={styles.bundleImport} aria-labelledby="bundle-import-title">
          <header>
            <h2 id="bundle-import-title">导入 JSON 研究包</h2>
          </header>
          <p>只接受当前 Schema、当前 Brief 指纹和公开 HTTP(S) 来源；单文件最大 2 MiB。</p>
          <label htmlFor="research-bundle-file">选择 Agent 返回的 JSON</label>
          <input
            ref={fileInput}
            id="research-bundle-file"
            type="file"
            accept=".json,application/json,application/schema+json"
            disabled={busy !== null || replacementBlocked}
            onChange={(event) => {
              chooseFile(event.currentTarget.files?.[0] ?? null);
            }}
          />
          <div className={styles.selectedFile} aria-live="polite">
            {selectedFile ? (
              <>
                <strong>{selectedFile.name}</strong>
                <span>{byteLabel(selectedFile.size)}</span>
                <button
                  type="button"
                  className="button-link"
                  disabled={busy !== null}
                  onClick={() => {
                    setSelectedFile(null);
                    if (fileInput.current) fileInput.current.value = '';
                  }}
                >
                  移除
                </button>
              </>
            ) : (
              <span>尚未选择文件</span>
            )}
          </div>
          <button
            type="button"
            className="button-secondary"
            disabled={busy !== null || !selectedFile || replacementBlocked}
            onClick={() => void importBundle()}
          >
            {busy === 'import' ? '校验并导入中…' : '校验并导入候选'}
          </button>
          {current.request.bundleFileVersionNo ? (
            <small>当前 Bundle 版本：v{current.request.bundleFileVersionNo} / 5</small>
          ) : null}
        </section>
      </div>

      {feedback ? (
        <p
          ref={feedbackRef}
          className={`form-feedback ${feedbackError ? 'error' : 'success'}`}
          role={feedbackError ? 'alert' : 'status'}
          tabIndex={-1}
        >
          {feedback}
        </p>
      ) : null}

      {current.warnings.length > 0 ? (
        <aside className={styles.warnings} aria-labelledby="research-warnings-title">
          <h2 id="research-warnings-title">研究包警告</h2>
          <ul>
            {current.warnings.map((warning, index) => (
              <li key={`${String(index)}-${warning}`}>{warning}</li>
            ))}
          </ul>
        </aside>
      ) : null}

      <section className={styles.reviewQueue} aria-labelledby="candidate-review-title">
        <header className={styles.sectionHeading}>
          <div>
            <h2 id="candidate-review-title">候选审核</h2>
          </div>
          <span>
            待审核 {pendingCandidates.length} · 已拒绝 {rejectedCount}
          </span>
        </header>
        {pendingCandidates.length > 0 ? (
          <div className={styles.experienceStack}>
            {pendingCandidates.map((experience) => (
              <CommunityExperienceRecord
                key={experience.id}
                experience={experience}
                questions={current.questions.filter(
                  (question) => question.experienceId === experience.id,
                )}
                occurrenceCounts={current.occurrenceCounts}
                actions={
                  <>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void review(experience.id, 'accept')}
                    >
                      {busy === `accept-${experience.id}` ? '接受中…' : '接受'}
                    </button>
                    <button
                      type="button"
                      className="button-secondary"
                      disabled={busy !== null}
                      onClick={() => void review(experience.id, 'reject')}
                    >
                      {busy === `reject-${experience.id}` ? '拒绝中…' : '拒绝'}
                    </button>
                  </>
                }
              />
            ))}
          </div>
        ) : (
          <p className={styles.emptyCopy}>
            {current.request.state === 'ready'
              ? '发布研究任务或导入 JSON 后，候选会在这里等待核对。'
              : allCandidatesRejected && !replacementBlocked
                ? '候选已全部拒绝，可以再次发布研究任务或导入新的 JSON。'
                : '当前没有待审核候选。'}
          </p>
        )}
      </section>

      <section className={styles.acceptedArchive} aria-labelledby="accepted-request-title">
        <header className={styles.sectionHeading}>
          <div>
            <h2 id="accepted-request-title">本次已接受</h2>
          </div>
          <span>{acceptedCandidates.length} 份</span>
        </header>
        {acceptedCandidates.length > 0 ? (
          <div className={styles.experienceStack}>
            {acceptedCandidates.map((experience) => (
              <CommunityExperienceRecord
                key={experience.id}
                experience={experience}
                questions={current.questions.filter(
                  (question) => question.experienceId === experience.id,
                )}
                occurrenceCounts={current.occurrenceCounts}
              />
            ))}
          </div>
        ) : (
          <p className={styles.emptyCopy}>还没有接受候选。每份面经都必须由你明确确认。</p>
        )}
      </section>
    </div>
  );
}
