'use client';

import type { CandidateProfileData } from '@jobhunter/domain';
import type { WebResumePolishStatus } from '@jobhunter/application/web';
import type { ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';
import { mutationHeaders } from '../../src/client/csrf.js';
import styles from './resume-polish.module.css';
import { useToast } from '../components/toast-provider.js';

interface AcceptedResponse {
  readonly data?: {
    readonly suggestionId: string;
    readonly task: { readonly taskId: string; readonly statusUrl: string };
  };
  readonly error?: { readonly message?: string };
}

interface StatusResponse {
  readonly data?: WebResumePolishStatus;
}

type ResumePolishSection = NonNullable<WebResumePolishStatus['suggestion']>['sections'][number];
type ResumePolishResult = NonNullable<WebResumePolishStatus['suggestion']>['result'];

const sectionLabels: Readonly<Record<ResumePolishSection, string>> = {
  workExperience: '工作 / 实习经历',
  projects: '项目经历',
};

function hasDescription(profile: CandidateProfileData, section: ResumePolishSection): boolean {
  return profile[section].some((item) => item.highlights.some((highlight) => highlight.trim()));
}

export function ResumePolish({
  profileId,
  versionId,
  draft,
  hasUnsavedChanges,
  onApply,
}: Readonly<{
  profileId: string;
  versionId: string;
  draft: CandidateProfileData;
  hasUnsavedChanges: boolean;
  onApply: (result: ResumePolishResult, sections: readonly ResumePolishSection[]) => void;
}>): ReactElement {
  const abortReference = useRef<AbortController | null>(null);
  const [sections, setSections] = useState<ResumePolishSection[]>([]);
  const [busy, setBusy] = useState(false);
  const { showToast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<StatusResponse['data']>();

  useEffect(
    () => () => {
      abortReference.current?.abort();
    },
    [],
  );

  const toggleSection = (section: ResumePolishSection, checked: boolean): void => {
    setSections((current) =>
      checked ? [...new Set([...current, section])] : current.filter((item) => item !== section),
    );
    setError(null);
    setSuggestion(undefined);
  };

  const track = async (statusUrl: string): Promise<void> => {
    abortReference.current?.abort();
    const controller = new AbortController();
    abortReference.current = controller;
    try {
      for (let attempt = 0; attempt < 90; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 2_000));
        if (controller.signal.aborted) return;
        const response = await fetch(statusUrl, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('润色任务状态暂时无法读取。');
        const body = (await response.json()) as StatusResponse;
        const data = body.data;
        const status = data?.status;
        if (data?.status === 'succeeded' && data.suggestion) {
          setSuggestion(data);
          showToast('AI 润色建议已生成，请预览后决定是否应用到草稿。');
          setBusy(false);
          return;
        }
        if (status === 'failed' || status === 'cancelled') {
          setError(
            status === 'cancelled'
              ? 'AI 润色任务已取消，可重新生成。'
              : (data?.errorSummary ?? 'AI 润色失败，请检查模型配置后重试。'),
          );
          setBusy(false);
          return;
        }
      }
      showToast('润色任务仍在后台运行，可稍后返回本页查看。', 'warning');
      setBusy(false);
    } catch {
      if (controller.signal.aborted) return;
      showToast('润色任务已创建，但自动刷新暂时不可用。', 'warning');
      setBusy(false);
    }
  };

  const generate = async (): Promise<void> => {
    if (hasUnsavedChanges) {
      setError('当前简历有尚未保存的修改，请先保存后再生成润色建议。');
      return;
    }
    if (!draft.targetRoles[0]) {
      setError('请先在“求职意向”中确认目标岗位。');
      return;
    }
    if (sections.length === 0) {
      setError('请至少选择一项需要润色的经历。');
      return;
    }
    if (sections.some((section) => !hasDescription(draft, section))) {
      setError('所选经历没有可润色的描述，请先补充内容。');
      return;
    }
    setBusy(true);
    setError(null);
    setSuggestion(undefined);
    try {
      const response = await fetch('/api/profile/polish', {
        method: 'POST',
        headers: await mutationHeaders(),
        body: JSON.stringify({
          profileId,
          sourceVersionId: versionId,
          sections,
          idempotencyToken: crypto.randomUUID(),
        }),
      });
      const body = (await response.json()) as AcceptedResponse;
      if (!response.ok || !body.data) {
        throw new Error(body.error?.message ?? 'AI 润色任务创建失败。');
      }
      showToast('AI 润色任务已创建。');
      void track(body.data.task.statusUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'AI 润色任务创建失败。');
      setBusy(false);
    }
  };

  const readySuggestion = suggestion?.suggestion;
  return (
    <section
      className={styles.root}
      aria-busy={busy}
      aria-labelledby="resume-polish-title"
      data-resume-polish
    >
      <header className={styles.heading}>
        <div className={styles.titleBlock}>
          <h3 id="resume-polish-title">按求职意向润色经历</h3>
          <p className={styles.targetRole}>
            目标岗位 <strong>{draft.targetRoles[0] ?? '尚未确认'}</strong>
          </p>
        </div>
        <p className={styles.guardrail}>仅优化表达，不新增事实</p>
      </header>
      <div className={styles.controls}>
        <fieldset className={styles.options}>
          <legend>润色范围</legend>
          <div className={styles.optionList}>
            {(Object.keys(sectionLabels) as ResumePolishSection[]).map((section) => {
              const available = hasDescription(draft, section);
              return (
                <label key={section}>
                  <input
                    type="checkbox"
                    checked={sections.includes(section)}
                    disabled={busy || !available}
                    onChange={(event) => {
                      toggleSection(section, event.currentTarget.checked);
                    }}
                  />
                  <span className={styles.optionCopy}>
                    {sectionLabels[section]}
                    {!available ? <small>暂无可润色描述</small> : null}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
        <div className={styles.actions}>
          <span>生成后先预览，不会自动覆盖简历</span>
          <button type="button" disabled={busy} onClick={() => void generate()}>
            {busy ? '正在生成…' : '生成 AI 润色建议'}
          </button>
        </div>
      </div>
      {error ? (
        <p className="form-feedback error" role="alert">
          {error}
        </p>
      ) : null}
      {readySuggestion ? (
        <div className={styles.suggestion}>
          <details open>
            <summary>预览润色建议</summary>
            {readySuggestion.sections.map((section) => {
              const result = readySuggestion.result[section];
              return result ? (
                <section key={section}>
                  <h4>{sectionLabels[section]}</h4>
                  {result.map((highlights, index) => (
                    <div key={index}>
                      <strong>第 {String(index + 1)} 项</strong>
                      {highlights.length ? (
                        <ul>
                          {highlights.map((highlight) => (
                            <li key={highlight}>{highlight}</li>
                          ))}
                        </ul>
                      ) : (
                        <p>原条目没有可改写的描述。</p>
                      )}
                    </div>
                  ))}
                </section>
              ) : null;
            })}
          </details>
          <button
            type="button"
            className="button-secondary"
            onClick={() => {
              onApply(readySuggestion.result, readySuggestion.sections);
              setSuggestion(undefined);
              showToast('润色建议已应用到草稿，请检查后保存简历。');
            }}
          >
            应用到草稿
          </button>
        </div>
      ) : null}
    </section>
  );
}
