'use client';

import type { ResumeDraftDetail } from '@jobhunter/application/web';
import {
  renderResumeHtml,
  resumeSectionIds,
  resumeSectionLabels,
  type ResumeDocumentContent,
  type ResumeSectionId,
  type ResumeTextStyle,
} from '@jobhunter/resume-template';
import type { ReactElement } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { mutationHeaders } from '../../../src/client/csrf.js';
import styles from './studio.module.css';

interface Envelope<T> {
  readonly data?: T;
  readonly error?: { readonly code?: string; readonly message?: string };
}

async function readEnvelope<T>(response: Response, fallback: string): Promise<Envelope<T>> {
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error(`${fallback}（服务返回了无法识别的响应，HTTP ${String(response.status)}）。`);
  }
  try {
    return (await response.json()) as Envelope<T>;
  } catch {
    throw new Error(`${fallback}（服务返回的数据格式无效）。`);
  }
}

type SaveState = 'saved' | 'dirty' | 'saving' | 'failed' | 'conflict';
type StudioSectionId = Exclude<ResumeSectionId, 'target'>;
type RepeatableSectionId =
  'education' | 'work' | 'projects' | 'works' | 'competitions' | 'certificates' | 'languages';

const studioSectionIds = resumeSectionIds.filter(
  (section): section is StudioSectionId => section !== 'target',
);
const repeatableSections: readonly RepeatableSectionId[] = [
  'education',
  'work',
  'projects',
  'works',
  'competitions',
  'certificates',
  'languages',
];
const onePageDefault: ResumeTextStyle = { fontSize: 12, letterSpacing: 0, lineHeight: 1.42 };
const standardDefault: ResumeTextStyle = { fontSize: 14, letterSpacing: 0, lineHeight: 1.55 };
const rounded = (value: number): number => Math.round(value * 100) / 100;

function ConfirmRefresh({
  onCancel,
  onConfirm,
  busy,
}: Readonly<{ onCancel: () => void; onConfirm: () => void; busy: boolean }>): ReactElement {
  const cancel = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    cancel.current?.focus();
    const keydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) onCancel();
      if (event.key !== 'Tab') return;
      const controls = [
        ...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? []),
      ];
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('keydown', keydown);
    };
  }, [busy, onCancel]);

  return (
    <div className={styles.backdrop}>
      <div
        ref={panel}
        className={styles.dialog}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="refresh-title"
      >
        <h2 id="refresh-title">使用最新在线简历重新生成？</h2>
        <p>当前模板中的文字修改会被替换，已经上传的头像会保留。此操作无法撤销。</p>
        <div>
          <button
            ref={cancel}
            type="button"
            className="button-secondary"
            onClick={onCancel}
            disabled={busy}
          >
            继续编辑
          </button>
          <button type="button" onClick={onConfirm} disabled={busy} aria-busy={busy}>
            {busy ? '正在更新…' : '重新生成'}
          </button>
        </div>
      </div>
    </div>
  );
}

function TemplatePreviewDialog({
  html,
  templateName,
  onClose,
  returnFocusTo,
}: Readonly<{
  html: string;
  templateName: string;
  onClose: () => void;
  returnFocusTo: HTMLButtonElement | null;
}>): ReactElement {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
    return () => {
      returnFocusTo?.focus();
    };
  }, [returnFocusTo]);

  return (
    <dialog
      ref={dialog}
      className={styles.previewDialog}
      aria-labelledby="template-preview-title"
      aria-describedby="template-preview-description"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <header className={styles.previewHeader}>
        <div>
          <h2 id="template-preview-title">{templateName} · 导出效果预览</h2>
          <p id="template-preview-description">与 HTML、PDF 使用相同模板，编辑标记已隐藏。</p>
        </div>
        <button type="button" className="button-muted" onClick={onClose} autoFocus>
          关闭预览
        </button>
      </header>
      <div className={styles.previewViewport}>
        <div className={styles.previewPaper}>
          <iframe title={`${templateName}导出效果预览`} srcDoc={html} sandbox="allow-same-origin" />
        </div>
      </div>
      <footer className={styles.previewFooter}>
        <span>空白章节已自动隐藏</span>
        <button type="button" className="button-secondary" onClick={onClose}>
          返回编辑
        </button>
      </footer>
    </dialog>
  );
}

function FormatControl({
  label,
  value,
  unit,
  onDecrease,
  onIncrease,
}: Readonly<{
  label: string;
  value: number;
  unit: string;
  onDecrease: () => void;
  onIncrease: () => void;
}>): ReactElement {
  return (
    <div className={styles.formatControl} role="group" aria-label={label}>
      <span>{label}</span>
      <button type="button" onClick={onDecrease} aria-label={`减小${label}`}>
        −
      </button>
      <output aria-live="polite">
        {value}
        {unit}
      </output>
      <button type="button" onClick={onIncrease} aria-label={`增大${label}`}>
        ＋
      </button>
    </div>
  );
}

function setValueAtPath(
  content: ResumeDocumentContent,
  path: string,
  value: string,
): ResumeDocumentContent {
  if (path === 'targetRoles') {
    return {
      ...content,
      targetRoles: value
        .split(/[/，,]/u)
        .map((item) => item.trim())
        .filter(Boolean),
    };
  }
  const next = structuredClone(content);
  const segments = path.split('.');
  let cursor: unknown = next;
  for (const segment of segments.slice(0, -1)) {
    if (Array.isArray(cursor)) cursor = cursor[Number(segment)];
    else if (cursor && typeof cursor === 'object')
      cursor = (cursor as Record<string, unknown>)[segment];
  }
  const final = segments.at(-1);
  if (!final) return next;
  if (Array.isArray(cursor)) cursor[Number(final)] = value.trim();
  else if (cursor && typeof cursor === 'object')
    (cursor as Record<string, unknown>)[final] = value.trim();
  return next;
}

function eventElement(event: Event): HTMLElement | null {
  const target = event.target as Partial<HTMLElement> | null;
  return target && typeof target.closest === 'function' ? (target as HTMLElement) : null;
}

export function ResumeStudio({ initial }: Readonly<{ initial: ResumeDraftDetail }>): ReactElement {
  const [content, setContent] = useState(initial.draft.content);
  const [revision, setRevision] = useState(initial.draft.revision);
  const [stale, setStale] = useState(initial.stale);
  const [active, setActive] = useState<StudioSectionId>('basic');
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [message, setMessage] = useState('已保存');
  const [showRefresh, setShowRefresh] = useState(false);
  const [previewContent, setPreviewContent] = useState<ResumeDocumentContent | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState<'pdf' | 'html' | null>(null);
  const iframe = useRef<HTMLIFrameElement>(null);
  const previewButton = useRef<HTMLButtonElement>(null);
  const pendingContent = useRef(initial.draft.content);
  const savedJson = useRef(JSON.stringify(initial.draft.content));
  const revisionRef = useRef(initial.draft.revision);
  const saveQueue = useRef(Promise.resolve(true));

  const html = useMemo(
    () =>
      renderResumeHtml({
        templateKey: initial.draft.templateKey,
        templateVersion: initial.draft.templateVersion,
        content,
        avatarDataUrl: initial.avatarDataUrl,
        interactive: true,
      }),
    [content, initial.avatarDataUrl, initial.draft.templateKey, initial.draft.templateVersion],
  );

  const previewHtml = useMemo(
    () =>
      previewContent
        ? renderResumeHtml({
            templateKey: initial.draft.templateKey,
            templateVersion: initial.draft.templateVersion,
            content: previewContent,
            avatarDataUrl: initial.avatarDataUrl,
            interactive: false,
          })
        : null,
    [
      initial.avatarDataUrl,
      initial.draft.templateKey,
      initial.draft.templateVersion,
      previewContent,
    ],
  );

  const save = async (next = pendingContent.current): Promise<boolean> => {
    const snapshot = JSON.stringify(next);
    if (snapshot === savedJson.current) return true;
    const perform = async (): Promise<boolean> => {
      if (snapshot === savedJson.current) return true;
      setSaveState('saving');
      setMessage('正在保存…');
      try {
        const response = await fetch(`/api/resume-drafts/${initial.draft.id}`, {
          method: 'PATCH',
          headers: await mutationHeaders(),
          body: JSON.stringify({ expectedRevision: revisionRef.current, content: next }),
        });
        const body = (await response.json()) as Envelope<ResumeDraftDetail>;
        if (!response.ok || !body.data) {
          const conflict = response.status === 409;
          setSaveState(conflict ? 'conflict' : 'failed');
          setMessage(body.error?.message ?? '草稿保存失败，请重试。');
          return false;
        }
        revisionRef.current = body.data.draft.revision;
        setRevision(body.data.draft.revision);
        savedJson.current = snapshot;
        setSaveState('saved');
        setMessage('已保存');
        return true;
      } catch {
        setSaveState('failed');
        setMessage('草稿保存失败，请检查本地服务后重试。');
        return false;
      }
    };
    const queued = saveQueue.current.then(perform, perform);
    saveQueue.current = queued;
    return queued;
  };

  const replaceContent = (next: ResumeDocumentContent, saveImmediately = false): void => {
    pendingContent.current = next;
    setContent(next);
    setSaveState('dirty');
    setMessage('有尚未保存的修改');
    if (saveImmediately) void save(next);
  };

  const markSection = (section: StudioSectionId, focus = false): void => {
    const canvasDocument = iframe.current?.contentDocument;
    if (!canvasDocument) return;
    for (const element of canvasDocument.querySelectorAll('.is-active'))
      element.classList.remove('is-active');
    const selected = canvasDocument.querySelector<HTMLElement>(`[data-section-id="${section}"]`);
    selected?.classList.add('is-active');
    selected?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (focus) selected?.querySelector<HTMLElement>('[data-field]')?.focus();
  };

  const switchSection = (section: StudioSectionId, focus = false): void => {
    setActive(section);
    window.setTimeout(() => {
      markSection(section, focus);
    }, 20);
  };

  useEffect(() => {
    const frame = iframe.current;
    if (!frame) return;
    const connect = (): void => {
      const canvasDocument = frame.contentDocument;
      if (!canvasDocument) return;
      markSection(active);
      canvasDocument.addEventListener('click', (event) => {
        const target = eventElement(event);
        const section = target?.closest<HTMLElement>('[data-section-id]')?.dataset.sectionId;
        if (!studioSectionIds.includes(section as StudioSectionId)) return;
        setActive(section as StudioSectionId);
        markSection(section as StudioSectionId);
      });
      canvasDocument.addEventListener('focusin', (event) => {
        const target = eventElement(event);
        if (!target) return;
        const section = target.closest<HTMLElement>('[data-section-id]')?.dataset.sectionId;
        if (!studioSectionIds.includes(section as StudioSectionId)) return;
        setActive(section as StudioSectionId);
        markSection(section as StudioSectionId);
      });
      canvasDocument.addEventListener('input', (event) => {
        const target = eventElement(event);
        if (!target) return;
        const editable = target.closest<HTMLElement>('[data-field]');
        const field = editable?.dataset.field;
        if (!field) return;
        pendingContent.current = setValueAtPath(
          pendingContent.current,
          field,
          field === 'professionalSkills' ? editable.innerText : editable.textContent,
        );
        setSaveState('dirty');
        setMessage('有尚未保存的修改');
      });
      canvasDocument.addEventListener('focusout', (event) => {
        const target = eventElement(event);
        if (!target?.closest('[data-field]')) return;
        setContent(pendingContent.current);
        void save(pendingContent.current);
      });
      canvasDocument.addEventListener('keydown', (event) => {
        const target = eventElement(event);
        if (!target) return;
        if (event.key === 'Enter' && !target.closest('[data-multiline]')) event.preventDefault();
      });
    };
    frame.addEventListener('load', connect);
    connect();
    return () => {
      frame.removeEventListener('load', connect);
    };
  }, [html]);

  const leaveStudio = async (): Promise<void> => {
    if (await save())
      window.location.assign(
        `/profile?profile=${encodeURIComponent(initial.draft.profileId)}#resume-basic`,
      );
  };

  const refresh = async (): Promise<void> => {
    setRefreshing(true);
    try {
      const response = await fetch(`/api/resume-drafts/${initial.draft.id}/refresh`, {
        method: 'POST',
        headers: await mutationHeaders(),
        body: JSON.stringify({ expectedRevision: revisionRef.current }),
      });
      const body = (await response.json()) as Envelope<ResumeDraftDetail>;
      if (!response.ok || !body.data) throw new Error(body.error?.message ?? '重新生成失败。');
      pendingContent.current = body.data.draft.content;
      setContent(body.data.draft.content);
      savedJson.current = JSON.stringify(body.data.draft.content);
      revisionRef.current = body.data.draft.revision;
      setRevision(body.data.draft.revision);
      setStale(false);
      setShowRefresh(false);
      setSaveState('saved');
      setMessage('已使用最新在线简历重新生成');
    } catch (cause) {
      setSaveState('failed');
      setMessage(cause instanceof Error ? cause.message : '重新生成失败。');
    } finally {
      setRefreshing(false);
    }
  };

  const exportResume = async (format: 'pdf' | 'html'): Promise<void> => {
    if (saveState === 'conflict' || !(await save())) return;
    setExporting(format);
    setMessage(format === 'pdf' ? '正在生成 PDF…' : '正在生成 HTML…');
    try {
      const response = await fetch(`/api/resume-drafts/${initial.draft.id}/exports`, {
        method: 'POST',
        headers: await mutationHeaders(),
        body: JSON.stringify({
          expectedRevision: revisionRef.current,
          format,
          idempotencyToken: crypto.randomUUID(),
        }),
      });
      const body = await readEnvelope<{ id: string; status: string }>(response, '简历导出失败。');
      if (!response.ok || !body.data) throw new Error(body.error?.message ?? '简历导出失败。');
      let status = body.data;
      for (
        let attempt = 0;
        format === 'pdf' && status.status === 'pending' && attempt < 120;
        attempt += 1
      ) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        const response = await fetch(
          `/api/resume-drafts/${initial.draft.id}/exports/${status.id}`,
          { cache: 'no-store' },
        );
        const polled = await readEnvelope<{
          id: string;
          status: string;
          errorSummary?: string | null;
        }>(response, '无法读取 PDF 生成状态。');
        if (!response.ok || !polled.data)
          throw new Error(polled.error?.message ?? '无法读取 PDF 生成状态。');
        status = polled.data;
        if (status.status === 'failed')
          throw new Error(polled.data.errorSummary ?? 'PDF 生成失败。');
      }
      if (status.status !== 'succeeded') throw new Error('PDF 生成超时，请稍后重试。');
      setMessage(format === 'pdf' ? 'PDF 已生成，正在导出…' : 'HTML 已生成，正在导出…');
      const link = document.createElement('a');
      link.href = `/api/resume-drafts/${initial.draft.id}/exports/${status.id}/file`;
      document.body.append(link);
      link.click();
      link.remove();
      setMessage(format === 'pdf' ? 'PDF 已导出' : 'HTML 已导出');
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : '简历导出失败。');
      setSaveState('failed');
    } finally {
      setExporting(null);
    }
  };

  const defaultStyle =
    initial.draft.templateKey === 'technical-blueprint' ? onePageDefault : standardDefault;
  const activeStyle = content.formatting?.[active] ?? defaultStyle;
  const applyStyle = (patch: Partial<ResumeTextStyle>): void => {
    replaceContent(
      {
        ...pendingContent.current,
        formatting: {
          ...pendingContent.current.formatting,
          [active]: { ...activeStyle, ...patch },
        },
      },
      true,
    );
  };
  const resetStyle = (): void => {
    const formatting = Object.fromEntries(
      Object.entries(pendingContent.current.formatting ?? {}).filter(
        ([section]) => section !== active,
      ),
    ) as ResumeDocumentContent['formatting'];
    replaceContent({ ...pendingContent.current, formatting }, true);
  };

  const activeList = repeatableSections.includes(active as RepeatableSectionId)
    ? pendingContent.current[
        active === 'work' ? 'workExperience' : (active as Exclude<RepeatableSectionId, 'work'>)
      ]
    : null;
  const addEntry = (): void => {
    const current = pendingContent.current;
    let next: ResumeDocumentContent;
    switch (active) {
      case 'education':
        next = {
          ...current,
          education: [
            ...current.education,
            { institution: '', degree: '', field: '', startDate: '', endDate: '' },
          ],
        };
        break;
      case 'work':
        next = {
          ...current,
          workExperience: [
            ...current.workExperience,
            { organization: '', title: '', startDate: '', endDate: '', highlights: [''] },
          ],
        };
        break;
      case 'projects':
        next = {
          ...current,
          projects: [
            ...current.projects,
            { name: '', role: '', startDate: '', endDate: '', highlights: [''] },
          ],
        };
        break;
      case 'works':
        next = { ...current, works: [...current.works, { name: '', description: '', url: '' }] };
        break;
      case 'competitions':
        next = {
          ...current,
          competitions: [...current.competitions, { name: '', award: '', date: '' }],
        };
        break;
      case 'certificates':
        next = {
          ...current,
          certificates: [...current.certificates, { name: '', issuer: '', date: '' }],
        };
        break;
      case 'languages':
        next = {
          ...current,
          languages: [...current.languages, { name: '', proficiency: '' }],
        };
        break;
      default:
        return;
    }
    replaceContent(next, true);
    window.setTimeout(() => {
      switchSection(active, true);
    }, 50);
  };

  const removeLastEntry = (): void => {
    const current = pendingContent.current;
    let next: ResumeDocumentContent;
    switch (active) {
      case 'education':
        next = { ...current, education: current.education.slice(0, -1) };
        break;
      case 'work':
        next = { ...current, workExperience: current.workExperience.slice(0, -1) };
        break;
      case 'projects':
        next = { ...current, projects: current.projects.slice(0, -1) };
        break;
      case 'works':
        next = { ...current, works: current.works.slice(0, -1) };
        break;
      case 'competitions':
        next = { ...current, competitions: current.competitions.slice(0, -1) };
        break;
      case 'certificates':
        next = { ...current, certificates: current.certificates.slice(0, -1) };
        break;
      case 'languages':
        next = { ...current, languages: current.languages.slice(0, -1) };
        break;
      default:
        return;
    }
    replaceContent(next, true);
  };

  return (
    <main id="main-content" className={styles.root} data-resume-studio tabIndex={-1}>
      <h1 className="sr-only">{initial.template.name}简历制作</h1>
      <header className={styles.topbar}>
        <button type="button" className={styles.back} onClick={() => void leaveStudio()}>
          ← 返回个人资料
        </button>
        <div>
          <strong>{initial.template.name}</strong>
          <span>草稿版本 {revision + 1}</span>
        </div>
        <div
          className={styles.saveState}
          data-resume-save-state
          data-state={saveState}
          role={saveState === 'failed' || saveState === 'conflict' ? 'alert' : 'status'}
        >
          <span>{message}</span>
          {saveState === 'failed' ? (
            <button type="button" onClick={() => void save()}>
              重试
            </button>
          ) : null}
          {saveState === 'conflict' ? (
            <button
              type="button"
              onClick={() => {
                window.location.reload();
              }}
            >
              重新载入
            </button>
          ) : null}
        </div>
        <div className={styles.exportActions}>
          <button
            ref={previewButton}
            type="button"
            className="button-secondary"
            disabled={exporting !== null}
            onClick={() => {
              setPreviewContent(pendingContent.current);
            }}
          >
            预览
          </button>
          <button
            type="button"
            className="button-secondary"
            disabled={exporting !== null || saveState === 'conflict'}
            onClick={() => void exportResume('html')}
          >
            {exporting === 'html' ? '正在导出…' : '导出 HTML'}
          </button>
          <button
            type="button"
            disabled={exporting !== null || saveState === 'conflict'}
            onClick={() => void exportResume('pdf')}
          >
            {exporting === 'pdf' ? '正在生成…' : '导出 PDF'}
          </button>
        </div>
      </header>
      {stale ? (
        <section className={styles.stale} aria-label="在线简历有新版本">
          <p>
            <strong>在线简历已有新版本</strong>
            <span>当前模板草稿不会自动覆盖。</span>
          </p>
          <button
            type="button"
            className="button-secondary"
            onClick={() => {
              setShowRefresh(true);
            }}
          >
            使用最新在线简历
          </button>
        </section>
      ) : null}
      <section className={styles.formatToolbar} aria-label="简历排版工具">
        <div className={styles.selectionHint}>
          <strong>{resumeSectionLabels[active]}</strong>
          <span>点击画布文字直接修改</span>
        </div>
        <div className={styles.formatControls} data-format-controls>
          <FormatControl
            label="字号"
            value={activeStyle.fontSize}
            unit="px"
            onDecrease={() => {
              applyStyle({ fontSize: Math.max(9, activeStyle.fontSize - 1) });
            }}
            onIncrease={() => {
              applyStyle({ fontSize: Math.min(24, activeStyle.fontSize + 1) });
            }}
          />
          <FormatControl
            label="字距"
            value={activeStyle.letterSpacing}
            unit="px"
            onDecrease={() => {
              applyStyle({
                letterSpacing: rounded(Math.max(-0.5, activeStyle.letterSpacing - 0.25)),
              });
            }}
            onIncrease={() => {
              applyStyle({ letterSpacing: rounded(Math.min(3, activeStyle.letterSpacing + 0.25)) });
            }}
          />
          <FormatControl
            label="行高"
            value={activeStyle.lineHeight}
            unit=""
            onDecrease={() => {
              applyStyle({ lineHeight: rounded(Math.max(1.2, activeStyle.lineHeight - 0.1)) });
            }}
            onIncrease={() => {
              applyStyle({ lineHeight: rounded(Math.min(2, activeStyle.lineHeight + 0.1)) });
            }}
          />
          <button type="button" className="button-secondary" onClick={resetStyle}>
            恢复默认
          </button>
        </div>
        {activeList ? (
          <div className={styles.entryActions}>
            <button type="button" className="button-secondary" onClick={addEntry}>
              添加一项
            </button>
            <button
              type="button"
              className="button-secondary"
              disabled={activeList.length === 0}
              onClick={removeLastEntry}
            >
              删除末项
            </button>
          </div>
        ) : null}
      </section>
      <div className={styles.workspace}>
        <aside className={styles.sidebar}>
          <nav className={styles.tabs} aria-label="简历章节">
            <p>选择章节并在画布内编辑</p>
            {studioSectionIds.map((section) => (
              <button
                key={section}
                type="button"
                className={active === section ? styles.activeTab : undefined}
                aria-current={active === section ? 'true' : undefined}
                onClick={() => {
                  switchSection(section, true);
                }}
              >
                {resumeSectionLabels[section]}
              </button>
            ))}
          </nav>
        </aside>
        <section className={styles.canvas} aria-label="可直接编辑的简历画布">
          <p className={styles.canvasHint}>点击任意文字块即可输入；移开焦点后自动保存。</p>
          <div className={styles.paperFrame}>
            <iframe
              ref={iframe}
              title={`${initial.template.name}可编辑简历`}
              srcDoc={html}
              sandbox="allow-same-origin"
            />
          </div>
        </section>
      </div>
      {showRefresh ? (
        <ConfirmRefresh
          busy={refreshing}
          onCancel={() => {
            setShowRefresh(false);
          }}
          onConfirm={() => void refresh()}
        />
      ) : null}
      {previewHtml ? (
        <TemplatePreviewDialog
          html={previewHtml}
          templateName={initial.template.name}
          returnFocusTo={previewButton.current}
          onClose={() => {
            setPreviewContent(null);
          }}
        />
      ) : null}
    </main>
  );
}
