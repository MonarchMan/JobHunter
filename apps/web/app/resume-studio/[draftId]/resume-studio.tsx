'use client';

import type { ResumeDraftDetail } from '@jobhunter/application/web';
import {
  renderResumeHtml,
  addResumeSection,
  removeResumeSection,
  isResumeSectionAdded,
  hasResumeSectionContent,
  initializeResumeSections,
  resumeSectionIds,
  resumeSectionLabels,
  type ResumeDocumentContent,
  type ResumeSectionId,
  type ResumeTextStyle,
} from '@jobhunter/resume-template';
import type { ReactElement } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { mutationHeaders } from '../../../src/client/csrf.js';
import { Icon } from '../../components/ui-icon.js';
import styles from './studio.module.css';
import { handleDescriptionKey, pastePlainText, readDescription } from './description-editor.js';

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

/** 删除整章使用应用内模态确认；原生 dialog 提供焦点隔离与 Escape 行为。 */
function ConfirmSectionDelete({
  section,
  onCancel,
  onConfirm,
  returnFocusTo,
}: Readonly<{
  section: StudioSectionId;
  onCancel: () => void;
  onConfirm: () => void;
  returnFocusTo: HTMLButtonElement | null;
}>): ReactElement {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    return () => {
      if (!returnFocusTo?.disabled) returnFocusTo?.focus();
    };
  }, [returnFocusTo]);
  return (
    <dialog
      ref={dialog}
      className={[styles.dialog, styles.deleteDialog].join(' ')}
      aria-labelledby="delete-section-title"
      aria-describedby="delete-section-description"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <h2 id="delete-section-title">删除{resumeSectionLabels[section]}？</h2>
      <p id="delete-section-description">
        此章节的模板内容及新增文本块将被清空，无法撤销。在线简历不受影响。
      </p>
      <div>
        <button type="button" className="button-secondary" autoFocus onClick={onCancel}>
          保留章节
        </button>
        <button type="button" className="button-danger" onClick={onConfirm}>
          删除章节
        </button>
      </div>
    </dialog>
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

/** 更新受控字段路径；富描述以结构化段落数组保存，普通字段保留纯文本。 */
function setValueAtPath(
  content: ResumeDocumentContent,
  path: string,
  value: string | ReturnType<typeof readDescription>,
): ResumeDocumentContent {
  // 1、求职方向保留原有数组契约。
  if (path === 'targetRoles' && typeof value === 'string') {
    return {
      ...content,
      targetRoles: value
        .split(/[/，,]/u)
        .map((item) => item.trim())
        .filter(Boolean),
    };
  }
  const next = structuredClone(content);
  // 2、字段路径由内置模板提供，不从粘贴内容读取任意对象路径。
  const segments = path.split('.');
  let cursor: unknown = next;
  for (const segment of segments.slice(0, -1)) {
    if (Array.isArray(cursor)) cursor = cursor[Number(segment)];
    else if (cursor && typeof cursor === 'object')
      cursor = (cursor as Record<string, unknown>)[segment];
  }
  const final = segments.at(-1);
  if (!final) return next;
  const normalized = typeof value === 'string' ? value.trim() : value;
  if (Array.isArray(cursor)) cursor[Number(final)] = normalized;
  else if (cursor && typeof cursor === 'object')
    (cursor as Record<string, unknown>)[final] = normalized;
  return next;
}

function eventElement(event: Event): HTMLElement | null {
  const target = event.target as Partial<HTMLElement> | null;
  return target && typeof target.closest === 'function' ? (target as HTMLElement) : null;
}

export function ResumeStudio({ initial }: Readonly<{ initial: ResumeDraftDetail }>): ReactElement {
  const initializedContent = useMemo(
    () => initializeResumeSections(initial.draft.content),
    [initial.draft.content],
  );
  const [content, setContent] = useState(initializedContent);
  const [revision, setRevision] = useState(initial.draft.revision);
  const [stale, setStale] = useState(initial.stale);
  const [active, setActive] = useState<StudioSectionId>('basic');
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [message, setMessage] = useState('已保存');
  const [showRefresh, setShowRefresh] = useState(false);
  const [deleteSection, setDeleteSection] = useState<StudioSectionId | null>(null);
  const sectionActionButton = useRef<HTMLButtonElement | null>(null);
  const [previewContent, setPreviewContent] = useState<ResumeDocumentContent | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState<'pdf' | 'html' | null>(null);
  const iframe = useRef<HTMLIFrameElement>(null);
  const previewButton = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<string | null>(null);
  const pendingContent = useRef(initializedContent);
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
    if (focus) selected?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    let disconnect: (() => void) | undefined;
    const connect = (event?: Event): void => {
      // 1、同一文档只注册一次监听；画布重建时释放旧文档上的监听器。
      disconnect?.();
      const controller = new AbortController();
      disconnect = () => {
        controller.abort();
      };
      const canvasDocument = frame.contentDocument;
      if (!canvasDocument?.documentElement) return;
      // 1.a、仅编辑控件消费后台令牌；模板正文仍保留独立投递色板。
      const tokens = getComputedStyle(document.documentElement);
      for (const token of ['--action', '--action-soft', '--danger', '--danger-soft']) {
        canvasDocument.documentElement.style.setProperty(token, tokens.getPropertyValue(token));
      }
      markSection(active);
      if (event && pendingFocus.current) {
        canvasDocument.querySelector<HTMLElement>(pendingFocus.current)?.focus();
        pendingFocus.current = null;
      }
      canvasDocument.addEventListener(
        'click',
        (event) => {
          const target = eventElement(event);
          const insertBlock =
            target?.closest<HTMLElement>('[data-insert-block]')?.dataset.insertBlock;
          if (insertBlock) {
            const [section, anchor] = insertBlock.split(':');
            if (!anchor) return;
            const separator = anchor.lastIndexOf('.');
            if (studioSectionIds.includes(section as StudioSectionId))
              addTextBlocks(
                Number(anchor.slice(separator + 1)),
                section as StudioSectionId,
                undefined,
                anchor.slice(0, separator).endsWith('.empty')
                  ? undefined
                  : anchor.slice(0, separator),
              );
            return;
          }
          const deleteBlock =
            target?.closest<HTMLElement>('[data-delete-block]')?.dataset.deleteBlock;
          if (deleteBlock) {
            // 1、只移除当前文本块的呈现，保留同一经历及其后插入的内容。
            const section = target.closest<HTMLElement>('[data-section-id]')?.dataset.sectionId;
            if (section)
              pendingFocus.current = `[data-section-id="${section}"] [data-field], [data-section-id="${section}"] button`;
            replaceContent(
              {
                ...pendingContent.current,
                hiddenBlocks: [
                  ...new Set([...(pendingContent.current.hiddenBlocks ?? []), deleteBlock]),
                ],
              },
              true,
            );
            return;
          }
          const insertRow = target?.closest<HTMLElement>('[data-insert-row]')?.dataset.insertRow;
          if (insertRow) {
            const [section, index, columns] = insertRow.split('.');
            if (studioSectionIds.includes(section as StudioSectionId))
              addTextBlocks(Number(columns), section as StudioSectionId, Number(index));
            return;
          }
          const removeRow = target?.closest<HTMLElement>('[data-remove-row]')?.dataset.removeRow;
          if (removeRow) {
            const [section, index] = removeRow.split('.');
            if (studioSectionIds.includes(section as StudioSectionId)) {
              const id = section as StudioSectionId;
              const remaining = (pendingContent.current.textRows?.[id]?.length ?? 1) - 1;
              pendingFocus.current =
                remaining > 0
                  ? `[data-field="textRows.${id}.${String(Math.min(Number(index), remaining - 1))}.cells.0"]`
                  : `[data-section-id="${id}"] button`;
              replaceContent(
                {
                  ...pendingContent.current,
                  textRows: {
                    ...pendingContent.current.textRows,
                    [id]: (pendingContent.current.textRows?.[id] ?? []).filter(
                      (_, i) => i !== Number(index),
                    ),
                  },
                },
                true,
              );
            }
            return;
          }
          const section = target?.closest<HTMLElement>('[data-section-id]')?.dataset.sectionId;
          if (!studioSectionIds.includes(section as StudioSectionId)) return;
          setActive(section as StudioSectionId);
          markSection(section as StudioSectionId);
        },
        { signal: controller.signal },
      );
      canvasDocument.addEventListener(
        'focusin',
        (event) => {
          const target = eventElement(event);
          if (!target) return;
          const section = target.closest<HTMLElement>('[data-section-id]')?.dataset.sectionId;
          if (!studioSectionIds.includes(section as StudioSectionId)) return;
          setActive(section as StudioSectionId);
          markSection(section as StudioSectionId);
        },
        { signal: controller.signal },
      );
      canvasDocument.addEventListener(
        'input',
        (event) => {
          const target = eventElement(event);
          if (!target) return;
          const editable = target.closest<HTMLElement>('[data-field]');
          const field = editable?.dataset.field;
          if (!field) return;
          pendingContent.current = setValueAtPath(
            pendingContent.current,
            field,
            editable.hasAttribute('data-description')
              ? readDescription(editable)
              : editable.hasAttribute('data-multiline')
                ? editable.innerText
                : editable.textContent,
          );
          setSaveState('dirty');
          setMessage('有尚未保存的修改');
        },
        { signal: controller.signal },
      );
      canvasDocument.addEventListener(
        'focusout',
        (event) => {
          const target = eventElement(event);
          if (!target?.closest('[data-field]')) return;
          // 2、失焦只保存快照，避免重载 iframe 导致下一字段焦点和撤销栈丢失。
          void save(pendingContent.current);
        },
        { signal: controller.signal },
      );
      canvasDocument.addEventListener(
        'keydown',
        (event) => {
          const target = eventElement(event);
          if (!target) return;
          if (event.isComposing) return;
          const description = target.closest<HTMLElement>('[data-description]');
          if (description) handleDescriptionKey(event, description);
          // 3、仅拦截单行文字的换行，按钮仍使用原生 Enter／Space 激活。
          if (
            event.key === 'Enter' &&
            target.closest('[data-field]') &&
            !target.closest('[data-multiline]')
          )
            event.preventDefault();
        },
        { signal: controller.signal },
      );
      canvasDocument.addEventListener(
        'paste',
        (event) => {
          const editable = eventElement(event)?.closest<HTMLElement>('[data-field]');
          if (editable) pastePlainText(event, editable);
        },
        { signal: controller.signal },
      );
    };
    frame.addEventListener('load', connect);
    connect();
    return () => {
      frame.removeEventListener('load', connect);
      disconnect?.();
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
      pendingContent.current = initializeResumeSections(body.data.draft.content);
      setContent(pendingContent.current);
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
  /** 在指定经历后插入空条目，保留其余经历的顺序和内容。 */
  const addEntry = (section: StudioSectionId = active, afterIndex?: number): void => {
    const current = pendingContent.current;
    let next: ResumeDocumentContent;
    switch (section) {
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
    // 1、空条目由各章节结构构造，再移动到被点击条目后方。
    const key = section === 'work' ? 'workExperience' : section;
    const items = [...next[key]];
    const added = items.pop();
    const index =
      afterIndex === undefined ? items.length : Math.max(0, Math.min(afterIndex + 1, items.length));
    if (added) items.splice(index, 0, added);
    next = { ...next, [key]: items };
    // 2、文档加载完成后聚焦新条目的首个字段，不依赖固定延时。
    pendingFocus.current = `[data-field^="${key}.${String(index)}."]`;
    setActive(section);
    replaceContent(next, true);
  };

  /** 为当前普通章节追加一组 1–3 栏内容块，每栏允许多段文字与列表。 */
  const addTextBlocks = (
    columns: number,
    section: StudioSectionId = active,
    afterIndex?: number,
    afterBlock?: string,
  ): void => {
    // 1、每栏从空段落开始，不虚构候选人经历。
    if (![1, 2, 3].includes(columns)) return;
    const rows = pendingContent.current.textRows?.[section] ?? [];
    const anchor = afterIndex === undefined ? afterBlock : rows[afterIndex]?.afterBlock;
    const row = {
      ...(anchor ? { afterBlock: anchor } : {}),
      cells: Array.from({ length: columns }, () => [{ type: 'paragraph' as const, text: '' }]),
    };
    const firstAnchored = rows.findIndex((item) => item.afterBlock === anchor);
    const index =
      afterIndex === undefined
        ? firstAnchored < 0
          ? rows.length
          : firstAnchored
        : Math.max(0, Math.min(afterIndex + 1, rows.length));
    const nextRows = [...rows];
    nextRows.splice(index, 0, row);
    pendingFocus.current = `[data-field="textRows.${section}.${String(index)}.cells.0"]`;
    setActive(section);
    // 2、按草稿原有 revision 即时保存，模板自身负责分栏渲染。
    replaceContent(
      {
        ...pendingContent.current,
        textRows: { ...pendingContent.current.textRows, [section]: nextRows },
      },
      true,
    );
  };

  /** 整章清空后将焦点交还该章节的新增入口，避免落到已删除的画布节点。 */
  const removeSection = (section: StudioSectionId): void => {
    // 1、使用共享章节所有权规则清理草稿并加入现有自动保存队列。
    replaceContent(removeResumeSection(pendingContent.current, section), true);
    // 2、React 提交 disabled 状态后，焦点恢复到同一行唯一可用的新增按钮。
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLButtonElement>(
          `[data-section-nav="${section}"] button[aria-label^="新增"]`,
        )
        ?.focus();
    });
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
        {activeList && isResumeSectionAdded(content, active) ? (
          <div className={styles.entryActions}>
            <button
              type="button"
              className="button-secondary"
              onClick={() => {
                addEntry();
              }}
            >
              添加一项
            </button>
          </div>
        ) : null}
      </section>
      <div className={styles.workspace}>
        <aside className={styles.sidebar}>
          <nav className={styles.tabs} aria-label="简历章节">
            <p>选择章节并在画布内编辑</p>
            {studioSectionIds.map((section) => {
              const added = isResumeSectionAdded(content, section);
              const label = resumeSectionLabels[section];
              return (
                <div key={section} className={styles.tabRow} data-section-nav={section}>
                  <button
                    type="button"
                    className={active === section && added ? styles.activeTab : undefined}
                    aria-current={active === section && added ? 'true' : undefined}
                    disabled={!added}
                    onClick={() => {
                      switchSection(section, true);
                    }}
                  >
                    {label}
                  </button>
                  <button
                    type="button"
                    className={styles.sectionAction}
                    aria-label={`新增${label}`}
                    title={added ? `${label}已添加` : `新增${label}`}
                    disabled={added || saveState === 'conflict'}
                    onClick={() => {
                      // 1、空白章节立即持久化；加载完成后聚焦首个输入块。
                      pendingFocus.current = `[data-section-id="${section}"] [data-field]`;
                      setActive(section);
                      replaceContent(addResumeSection(pendingContent.current, section), true);
                    }}
                  >
                    <Icon name="plus" size={14} />
                  </button>
                  <button
                    type="button"
                    className={styles.sectionAction}
                    aria-label={`删除${label}`}
                    title={`删除${label}`}
                    disabled={!added || saveState === 'conflict'}
                    onClick={(event) => {
                      sectionActionButton.current = event.currentTarget;
                      // 2、有内容先确认；空白章节直接移除，均不更改在线画像。
                      if (hasResumeSectionContent(pendingContent.current, section))
                        setDeleteSection(section);
                      else removeSection(section);
                    }}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              );
            })}
          </nav>
        </aside>
        <section className={styles.canvas} aria-label="可直接编辑的简历画布">
          <p className={styles.canvasHint}>点击任意文字块即可输入；移开焦点后自动保存。</p>
          <div className={styles.paperFrame}>
            <iframe
              ref={iframe}
              title={`${initial.template.name}可编辑简历`}
              srcDoc={html}
              // WebKit 需要此标记才能执行父页回调；srcDoc 首部 CSP 仍禁止文档脚本。
              sandbox="allow-same-origin allow-scripts"
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
      {deleteSection ? (
        <ConfirmSectionDelete
          section={deleteSection}
          returnFocusTo={sectionActionButton.current}
          onCancel={() => {
            setDeleteSection(null);
          }}
          onConfirm={() => {
            removeSection(deleteSection);
            setDeleteSection(null);
          }}
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
