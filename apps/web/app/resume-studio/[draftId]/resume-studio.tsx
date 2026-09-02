'use client';

import type { ResumeDraftDetail } from '@jobhunter/application/web';
import {
  renderResumeHtml,
  resumeSectionIds,
  resumeSectionLabels,
  type ResumeDocumentContent,
  type ResumeSectionId,
} from '@jobhunter/resume-template';
import type { ChangeEvent, ReactElement, ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { mutationHeaders } from '../../../src/client/csrf.js';
import styles from './studio.module.css';

interface Envelope<T> {
  readonly data?: T;
  readonly error?: { readonly code?: string; readonly message?: string };
}
type SaveState = 'saved' | 'dirty' | 'saving' | 'failed' | 'conflict';
const text = (value: string): string | null => value.trim() || null;
const lines = (value: string): string[] =>
  value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);

function Field({
  label,
  value,
  onChange,
  type = 'text',
}: Readonly<{
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  type?: string;
}>): ReactElement {
  return (
    <label>
      {label}
      <input
        type={type}
        value={value ?? ''}
        onChange={(event) => {
          onChange(text(event.currentTarget.value));
        }}
      />
    </label>
  );
}

function TextArea({
  label,
  value,
  onChange,
  rows = 6,
}: Readonly<{
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  rows?: number;
}>): ReactElement {
  return (
    <label>
      {label}
      <textarea
        className="resize-none"
        rows={rows}
        value={value ?? ''}
        onChange={(event) => {
          onChange(text(event.currentTarget.value));
        }}
      />
    </label>
  );
}

function Repeater({
  title,
  count,
  onAdd,
  children,
}: Readonly<{
  title: string;
  count: number;
  onAdd: () => void;
  children: ReactNode;
}>): ReactElement {
  return (
    <div className={styles.repeater}>
      <div className={styles.repeaterHeading}>
        <span>
          {count} 条{title}
        </span>
        <button type="button" className="button-secondary" onClick={onAdd}>
          添加{title}
        </button>
      </div>
      {children}
    </div>
  );
}

function RemoveButton({
  label,
  onClick,
}: Readonly<{ label: string; onClick: () => void }>): ReactElement {
  return (
    <button type="button" className="button-muted" onClick={onClick}>
      删除{label}
    </button>
  );
}

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

export function ResumeStudio({ initial }: Readonly<{ initial: ResumeDraftDetail }>): ReactElement {
  const [content, setContent] = useState(initial.draft.content);
  const [revision, setRevision] = useState(initial.draft.revision);
  const [stale, setStale] = useState(initial.stale);
  const [avatar, setAvatar] = useState(initial.avatarDataUrl);
  const [active, setActive] = useState<ResumeSectionId>('basic');
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [message, setMessage] = useState('已保存');
  const [showRefresh, setShowRefresh] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState<'pdf' | 'html' | null>(null);
  const iframe = useRef<HTMLIFrameElement>(null);
  const savedJson = useRef(JSON.stringify(initial.draft.content));
  const revisionRef = useRef(initial.draft.revision);
  const saveQueue = useRef(Promise.resolve(true));

  const html = useMemo(
    () =>
      renderResumeHtml({
        templateKey: initial.draft.templateKey,
        templateVersion: initial.draft.templateVersion,
        content,
        avatarDataUrl: avatar,
        activeSection: active,
      }),
    [active, avatar, content, initial.draft.templateKey, initial.draft.templateVersion],
  );

  const change = (next: ResumeDocumentContent): void => {
    setContent(next);
    setSaveState('dirty');
    setMessage('有尚未保存的修改');
  };

  const save = async (next = content): Promise<boolean> => {
    const snapshot = JSON.stringify(next);
    if (snapshot === savedJson.current) return true;
    const perform = async (): Promise<boolean> => {
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

  const structural = (next: ResumeDocumentContent): void => {
    change(next);
    void save(next);
  };

  const updateBasic = (
    key: keyof ResumeDocumentContent['basicInfo'],
    value: string | null,
  ): void => {
    change({ ...content, basicInfo: { ...content.basicInfo, [key]: value } });
  };
  const removeAt = (
    key:
      | 'education'
      | 'workExperience'
      | 'projects'
      | 'works'
      | 'competitions'
      | 'certificates'
      | 'languages',
    index: number,
  ): void => {
    structural({ ...content, [key]: content[key].filter((_, itemIndex) => itemIndex !== index) });
  };

  const switchSection = (section: ResumeSectionId): void => {
    setActive(section);
    window.setTimeout(
      () =>
        iframe.current?.contentDocument
          ?.querySelector(`[data-section-id="${section}"]`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      20,
    );
  };

  const leaveStudio = async (): Promise<void> => {
    if (await save(content))
      window.location.assign(
        `/profile?profile=${encodeURIComponent(initial.draft.profileId)}#resume-basic`,
      );
  };

  const uploadAvatar = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setSaveState('failed');
      setMessage('头像仅支持不超过 5 MiB 的 JPEG 或 PNG。');
      return;
    }
    setSaveState('saving');
    setMessage('正在保存头像…');
    const form = new FormData();
    form.set('avatar', file);
    form.set('expectedRevision', String(revisionRef.current));
    try {
      const response = await fetch(`/api/resume-drafts/${initial.draft.id}/avatar`, {
        method: 'POST',
        headers: await mutationHeaders(false),
        body: form,
      });
      const body = (await response.json()) as Envelope<ResumeDraftDetail>;
      if (!response.ok || !body.data) throw new Error(body.error?.message ?? '头像保存失败。');
      revisionRef.current = body.data.draft.revision;
      setRevision(body.data.draft.revision);
      setAvatar(body.data.avatarDataUrl);
      setSaveState('saved');
      setMessage('头像已保存');
    } catch (cause) {
      setSaveState('failed');
      setMessage(cause instanceof Error ? cause.message : '头像保存失败。');
    }
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
    if (saveState === 'conflict') return;
    const saved = await save(content);
    if (!saved) return;
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
      const body = (await response.json()) as Envelope<{ id: string; status: string }>;
      if (!response.ok || !body.data) throw new Error(body.error?.message ?? '简历导出失败。');
      let status = body.data;
      for (
        let attempt = 0;
        format === 'pdf' && status.status === 'pending' && attempt < 120;
        attempt += 1
      ) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        const poll = await fetch(`/api/resume-drafts/${initial.draft.id}/exports/${status.id}`, {
          cache: 'no-store',
        });
        const polled = (await poll.json()) as Envelope<{
          id: string;
          status: string;
          errorSummary?: string | null;
        }>;
        if (!poll.ok || !polled.data)
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

  const sectionForm = (): ReactElement => {
    switch (active) {
      case 'basic':
        return (
          <div className={styles.fieldGrid}>
            <Field
              label="姓名"
              value={content.basicInfo.name}
              onChange={(value) => {
                updateBasic('name', value);
              }}
            />
            <Field
              label="手机号码"
              value={content.basicInfo.phone}
              onChange={(value) => {
                updateBasic('phone', value);
              }}
              type="tel"
            />
            <Field
              label="邮箱"
              value={content.basicInfo.email}
              onChange={(value) => {
                updateBasic('email', value);
              }}
              type="email"
            />
            <Field
              label="所在城市"
              value={content.basicInfo.location}
              onChange={(value) => {
                updateBasic('location', value);
              }}
            />
            <Field
              label="个人主页"
              value={content.basicInfo.website}
              onChange={(value) => {
                updateBasic('website', value);
              }}
              type="url"
            />
            <label className={styles.avatarField}>
              个人头像
              <input
                type="file"
                accept="image/jpeg,image/png"
                onChange={(event) => void uploadAvatar(event)}
              />
              <span>JPEG / PNG，不超过 5 MiB</span>
            </label>
          </div>
        );
      case 'target':
        return (
          <label>
            目标岗位
            <input
              value={content.targetRoles.join('，')}
              onChange={(event) => {
                change({
                  ...content,
                  targetRoles: event.currentTarget.value
                    .split(/[，,]/u)
                    .map((item) => item.trim())
                    .filter(Boolean),
                });
              }}
            />
          </label>
        );
      case 'education':
        return (
          <Repeater
            title="教育经历"
            count={content.education.length}
            onAdd={() => {
              structural({
                ...content,
                education: [
                  ...content.education,
                  { institution: null, degree: null, field: null, startDate: null, endDate: null },
                ],
              });
            }}
          >
            {content.education.map((item, index) => (
              <article className={styles.entry} key={index}>
                <div className={styles.fieldGrid}>
                  <Field
                    label="学校"
                    value={item.institution}
                    onChange={(value) => {
                      const next = [...content.education];
                      next[index] = { ...item, institution: value };
                      change({ ...content, education: next });
                    }}
                  />
                  <Field
                    label="学历"
                    value={item.degree}
                    onChange={(value) => {
                      const next = [...content.education];
                      next[index] = { ...item, degree: value };
                      change({ ...content, education: next });
                    }}
                  />
                  <Field
                    label="专业"
                    value={item.field}
                    onChange={(value) => {
                      const next = [...content.education];
                      next[index] = { ...item, field: value };
                      change({ ...content, education: next });
                    }}
                  />
                  <Field
                    label="开始日期"
                    type="date"
                    value={item.startDate}
                    onChange={(value) => {
                      const next = [...content.education];
                      next[index] = { ...item, startDate: value };
                      change({ ...content, education: next });
                    }}
                  />
                  <Field
                    label="结束日期"
                    type="date"
                    value={item.endDate}
                    onChange={(value) => {
                      const next = [...content.education];
                      next[index] = { ...item, endDate: value };
                      change({ ...content, education: next });
                    }}
                  />
                </div>
                <RemoveButton
                  label="教育经历"
                  onClick={() => {
                    removeAt('education', index);
                  }}
                />
              </article>
            ))}
          </Repeater>
        );
      case 'work':
        return (
          <Repeater
            title="工作经历"
            count={content.workExperience.length}
            onAdd={() => {
              structural({
                ...content,
                workExperience: [
                  ...content.workExperience,
                  { organization: null, title: '', startDate: null, endDate: null, highlights: [] },
                ],
              });
            }}
          >
            {content.workExperience.map((item, index) => (
              <article className={styles.entry} key={index}>
                <div className={styles.fieldGrid}>
                  <Field
                    label="公司 / 组织"
                    value={item.organization}
                    onChange={(value) => {
                      const next = [...content.workExperience];
                      next[index] = { ...item, organization: value };
                      change({ ...content, workExperience: next });
                    }}
                  />
                  <Field
                    label="职位"
                    value={item.title}
                    onChange={(value) => {
                      const next = [...content.workExperience];
                      next[index] = { ...item, title: value ?? '' };
                      change({ ...content, workExperience: next });
                    }}
                  />
                  <Field
                    label="开始日期"
                    type="date"
                    value={item.startDate}
                    onChange={(value) => {
                      const next = [...content.workExperience];
                      next[index] = { ...item, startDate: value };
                      change({ ...content, workExperience: next });
                    }}
                  />
                  <Field
                    label="结束日期"
                    type="date"
                    value={item.endDate}
                    onChange={(value) => {
                      const next = [...content.workExperience];
                      next[index] = { ...item, endDate: value };
                      change({ ...content, workExperience: next });
                    }}
                  />
                </div>
                <TextArea
                  label="工作描述（每行一条）"
                  value={item.highlights.join('\n')}
                  onChange={(value) => {
                    const next = [...content.workExperience];
                    next[index] = { ...item, highlights: lines(value ?? '') };
                    change({ ...content, workExperience: next });
                  }}
                />
                <RemoveButton
                  label="工作经历"
                  onClick={() => {
                    removeAt('workExperience', index);
                  }}
                />
              </article>
            ))}
          </Repeater>
        );
      case 'projects':
        return (
          <Repeater
            title="项目"
            count={content.projects.length}
            onAdd={() => {
              structural({
                ...content,
                projects: [
                  ...content.projects,
                  { name: '', role: null, startDate: null, endDate: null, highlights: [] },
                ],
              });
            }}
          >
            {content.projects.map((item, index) => (
              <article className={styles.entry} key={index}>
                <div className={styles.fieldGrid}>
                  <Field
                    label="项目名称"
                    value={item.name}
                    onChange={(value) => {
                      const next = [...content.projects];
                      next[index] = { ...item, name: value ?? '' };
                      change({ ...content, projects: next });
                    }}
                  />
                  <Field
                    label="项目角色"
                    value={item.role}
                    onChange={(value) => {
                      const next = [...content.projects];
                      next[index] = { ...item, role: value };
                      change({ ...content, projects: next });
                    }}
                  />
                  <Field
                    label="开始日期"
                    type="date"
                    value={item.startDate}
                    onChange={(value) => {
                      const next = [...content.projects];
                      next[index] = { ...item, startDate: value };
                      change({ ...content, projects: next });
                    }}
                  />
                  <Field
                    label="结束日期"
                    type="date"
                    value={item.endDate}
                    onChange={(value) => {
                      const next = [...content.projects];
                      next[index] = { ...item, endDate: value };
                      change({ ...content, projects: next });
                    }}
                  />
                </div>
                <TextArea
                  label="项目描述（每行一条）"
                  value={item.highlights.join('\n')}
                  onChange={(value) => {
                    const next = [...content.projects];
                    next[index] = { ...item, highlights: lines(value ?? '') };
                    change({ ...content, projects: next });
                  }}
                />
                <RemoveButton
                  label="项目"
                  onClick={() => {
                    removeAt('projects', index);
                  }}
                />
              </article>
            ))}
          </Repeater>
        );
      case 'works':
        return (
          <Repeater
            title="作品"
            count={content.works.length}
            onAdd={() => {
              structural({
                ...content,
                works: [...content.works, { name: '', description: null, url: null }],
              });
            }}
          >
            {content.works.map((item, index) => (
              <article className={styles.entry} key={index}>
                <Field
                  label="作品名称"
                  value={item.name}
                  onChange={(value) => {
                    const next = [...content.works];
                    next[index] = { ...item, name: value ?? '' };
                    change({ ...content, works: next });
                  }}
                />
                <Field
                  label="链接"
                  value={item.url}
                  onChange={(value) => {
                    const next = [...content.works];
                    next[index] = { ...item, url: value };
                    change({ ...content, works: next });
                  }}
                />
                <TextArea
                  label="说明"
                  value={item.description}
                  onChange={(value) => {
                    const next = [...content.works];
                    next[index] = { ...item, description: value };
                    change({ ...content, works: next });
                  }}
                />
                <RemoveButton
                  label="作品"
                  onClick={() => {
                    removeAt('works', index);
                  }}
                />
              </article>
            ))}
          </Repeater>
        );
      case 'competitions':
        return (
          <Repeater
            title="竞赛"
            count={content.competitions.length}
            onAdd={() => {
              structural({
                ...content,
                competitions: [...content.competitions, { name: '', award: null, date: null }],
              });
            }}
          >
            {content.competitions.map((item, index) => (
              <article className={styles.entry} key={index}>
                <Field
                  label="竞赛名称"
                  value={item.name}
                  onChange={(value) => {
                    const next = [...content.competitions];
                    next[index] = { ...item, name: value ?? '' };
                    change({ ...content, competitions: next });
                  }}
                />
                <Field
                  label="奖项"
                  value={item.award}
                  onChange={(value) => {
                    const next = [...content.competitions];
                    next[index] = { ...item, award: value };
                    change({ ...content, competitions: next });
                  }}
                />
                <Field
                  label="时间"
                  type="date"
                  value={item.date}
                  onChange={(value) => {
                    const next = [...content.competitions];
                    next[index] = { ...item, date: value };
                    change({ ...content, competitions: next });
                  }}
                />
                <RemoveButton
                  label="竞赛"
                  onClick={() => {
                    removeAt('competitions', index);
                  }}
                />
              </article>
            ))}
          </Repeater>
        );
      case 'certificates':
        return (
          <Repeater
            title="证书"
            count={content.certificates.length}
            onAdd={() => {
              structural({
                ...content,
                certificates: [...content.certificates, { name: '', issuer: null, date: null }],
              });
            }}
          >
            {content.certificates.map((item, index) => (
              <article className={styles.entry} key={index}>
                <Field
                  label="证书名称"
                  value={item.name}
                  onChange={(value) => {
                    const next = [...content.certificates];
                    next[index] = { ...item, name: value ?? '' };
                    change({ ...content, certificates: next });
                  }}
                />
                <Field
                  label="颁发机构"
                  value={item.issuer}
                  onChange={(value) => {
                    const next = [...content.certificates];
                    next[index] = { ...item, issuer: value };
                    change({ ...content, certificates: next });
                  }}
                />
                <Field
                  label="取得时间"
                  type="date"
                  value={item.date}
                  onChange={(value) => {
                    const next = [...content.certificates];
                    next[index] = { ...item, date: value };
                    change({ ...content, certificates: next });
                  }}
                />
                <RemoveButton
                  label="证书"
                  onClick={() => {
                    removeAt('certificates', index);
                  }}
                />
              </article>
            ))}
          </Repeater>
        );
      case 'languages':
        return (
          <Repeater
            title="语言"
            count={content.languages.length}
            onAdd={() => {
              structural({
                ...content,
                languages: [...content.languages, { name: '', proficiency: null }],
              });
            }}
          >
            {content.languages.map((item, index) => (
              <article className={styles.entry} key={index}>
                <Field
                  label="语言"
                  value={item.name}
                  onChange={(value) => {
                    const next = [...content.languages];
                    next[index] = { ...item, name: value ?? '' };
                    change({ ...content, languages: next });
                  }}
                />
                <Field
                  label="熟练程度"
                  value={item.proficiency}
                  onChange={(value) => {
                    const next = [...content.languages];
                    next[index] = { ...item, proficiency: value };
                    change({ ...content, languages: next });
                  }}
                />
                <RemoveButton
                  label="语言"
                  onClick={() => {
                    removeAt('languages', index);
                  }}
                />
              </article>
            ))}
          </Repeater>
        );
      case 'skills':
        return (
          <TextArea
            label="专业技能"
            value={content.professionalSkills}
            onChange={(value) => {
              change({ ...content, professionalSkills: value });
            }}
            rows={10}
          />
        );
      case 'evaluation':
        return (
          <TextArea
            label="自我评价"
            value={content.selfEvaluation}
            onChange={(value) => {
              change({ ...content, selfEvaluation: value });
            }}
            rows={10}
          />
        );
    }
  };

  return (
    <main
      id="main-content"
      className={styles.root}
      data-resume-studio
      tabIndex={-1}
      onBlur={(event) => {
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
          void save(content);
      }}
    >
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
          data-state={saveState}
          role={saveState === 'failed' || saveState === 'conflict' ? 'alert' : 'status'}
        >
          <span>{message}</span>
          {saveState === 'failed' ? (
            <button type="button" onClick={() => void save(content)}>
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
      <div className={styles.workspace}>
        <aside className={styles.sidebar}>
          <nav className={styles.tabs} aria-label="简历章节" role="tablist">
            {resumeSectionIds.map((section) => (
              <button
                key={section}
                type="button"
                role="tab"
                aria-selected={active === section}
                aria-controls="resume-section-panel"
                className={active === section ? styles.activeTab : undefined}
                onClick={() => {
                  switchSection(section);
                }}
              >
                {resumeSectionLabels[section]}
              </button>
            ))}
          </nav>
          <div
            id="resume-section-panel"
            role="tabpanel"
            aria-label={`${resumeSectionLabels[active]}编辑表单`}
          >
            <form
              className={styles.form}
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
              }}
            >
              <header>
                <h1>{resumeSectionLabels[active]}</h1>
                <p>修改后离开字段即可保存。</p>
              </header>
              {sectionForm()}
            </form>
          </div>
        </aside>
        <section className={styles.canvas} aria-label="简历模板实时预览">
          <div className={styles.paperFrame}>
            <iframe
              ref={iframe}
              title={`${initial.template.name}简历实时预览`}
              srcDoc={html}
              sandbox="allow-same-origin"
              onLoad={() =>
                iframe.current?.contentDocument
                  ?.querySelector(`[data-section-id="${active}"]`)
                  ?.scrollIntoView({ block: 'start' })
              }
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
    </main>
  );
}
