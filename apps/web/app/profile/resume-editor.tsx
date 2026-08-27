'use client';

import type { CandidateProfileData } from '@jobhunter/domain';
import type { ReactElement, ReactNode, SyntheticEvent } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { mutationHeaders } from '../../src/client/csrf.js';
import styles from './resume-editor.module.css';

function classNames(...names: readonly (string | false | undefined)[]): string {
  return names.filter(Boolean).join(' ');
}
import { Icon } from '../components/ui-icon.js';

type Draft = CandidateProfileData;
type Experience = Draft['workExperience'][number];
type Project = Draft['projects'][number];

const emptyEvidence = (): [] => [];
const text = (value: string): string | null => value.trim() || null;
const list = (value: string): string[] =>
  value
    .split(/[，,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
const filled = (value: string | null | undefined): value is string => Boolean(value?.trim());
const meaningful = (value: string | null | undefined): value is string =>
  filled(value) && !value.startsWith('待填写');
const dateInputValue = (value: string | null): string =>
  value && /^\d{4}-\d{2}$/.test(value) ? `${value}-01` : (value ?? '');

function cleanDraft(profile: Draft): Draft {
  return {
    ...profile,
    education: profile.education.filter((item) =>
      [item.institution, item.degree, item.field, item.startDate, item.endDate].some(filled),
    ),
    workExperience: profile.workExperience.filter(
      (item) =>
        meaningful(item.organization) ||
        meaningful(item.title) ||
        item.highlights.some(filled) ||
        filled(item.startDate) ||
        filled(item.endDate),
    ),
    projects: profile.projects.filter(
      (item) =>
        meaningful(item.name) ||
        filled(item.role) ||
        item.highlights.some(filled) ||
        filled(item.startDate) ||
        filled(item.endDate),
    ),
    works: profile.works.filter(
      (item) => meaningful(item.name) || filled(item.description) || filled(item.url),
    ),
    competitions: profile.competitions.filter(
      (item) => meaningful(item.name) || filled(item.award) || filled(item.date),
    ),
    certificates: profile.certificates.filter(
      (item) => meaningful(item.name) || filled(item.issuer) || filled(item.date),
    ),
    languages: profile.languages.filter(
      (item) => meaningful(item.name) || filled(item.proficiency),
    ),
    skills: profile.skills.filter((item) => meaningful(item.name)),
  };
}

function prepareDraft(profile: Draft): Draft {
  return {
    ...profile,
    education: profile.education.map((item) => ({
      ...item,
      startDate: dateInputValue(item.startDate),
      endDate: dateInputValue(item.endDate),
    })),
    workExperience: profile.workExperience.map((item) => ({
      ...item,
      startDate: dateInputValue(item.startDate),
      endDate: dateInputValue(item.endDate),
    })),
    projects: profile.projects.map((item) => ({
      ...item,
      startDate: dateInputValue(item.startDate),
      endDate: dateInputValue(item.endDate),
    })),
    professionalSkills:
      profile.professionalSkills ??
      ([...profile.skills.map((skill) => skill.name), ...profile.domains].join('、') || null),
  };
}

function EditorSection({
  id,
  title,
  description,
  children,
}: Readonly<{
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}>): ReactElement {
  return (
    <section className={styles['resume-edit-section']} id={id} aria-labelledby={`${id}-title`}>
      <header>
        <div>
          <h3 id={`${id}-title`}>{title}</h3>
          <p>{description}</p>
        </div>
      </header>
      {children}
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: Readonly<{
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  type?: 'text' | 'email' | 'tel' | 'url' | 'date';
}>): ReactElement {
  return (
    <label>
      {label}
      <input
        type={type}
        lang={type === 'date' ? 'en-CA' : undefined}
        value={type === 'date' ? dateInputValue(value) : (value ?? '')}
        placeholder={placeholder}
        onChange={(event) => {
          onChange(text(event.currentTarget.value));
        }}
      />
    </label>
  );
}

function IsoDateInput({
  label,
  value,
  onChange,
}: Readonly<{
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
}>): ReactElement {
  const normalized = dateInputValue(value);
  return (
    <span className={styles['iso-date-input']} data-iso-date-input>
      <span
        className={classNames(styles['iso-date-display'], !normalized && styles['is-placeholder'])}
        data-iso-date-display
        aria-hidden="true"
      >
        <span>{normalized || 'YYYY-MM-DD'}</span>
        <Icon name="calendar" />
      </span>
      <input
        className={styles['iso-date-native']}
        type="date"
        lang="zh-CN"
        aria-label={label}
        value={normalized}
        onChange={(event) => {
          onChange(text(event.currentTarget.value));
        }}
      />
    </span>
  );
}

function DateRangeField({
  start,
  end,
  onStartChange,
  onEndChange,
}: Readonly<{
  start: string | null;
  end: string | null;
  onStartChange: (value: string | null) => void;
  onEndChange: (value: string | null) => void;
}>): ReactElement {
  const titleId = useId();
  return (
    <div
      className={styles['resume-date-range']}
      data-resume-date-range
      role="group"
      aria-labelledby={titleId}
    >
      <span className={styles['resume-date-range-title']} data-resume-date-range-title id={titleId}>
        起止时间
      </span>
      <div className={styles['resume-date-range-controls']}>
        <IsoDateInput label="开始日期" value={start} onChange={onStartChange} />
        <span aria-hidden="true">—</span>
        <IsoDateInput label="结束日期" value={end} onChange={onEndChange} />
      </div>
    </div>
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
    <div className={styles['resume-repeater']}>
      <div className={styles['resume-repeater-heading']}>
        <span>{count ? `${String(count)} 项` : '尚未填写'}</span>
        <button type="button" className="button-secondary" onClick={onAdd}>
          ＋ 添加{title}
        </button>
      </div>
      {children}
    </div>
  );
}

function RemoveButton({
  label,
  onRemove,
}: Readonly<{ label: string; onRemove: () => void }>): ReactElement {
  return (
    <button
      type="button"
      className={classNames('button-link', styles['resume-remove'])}
      onClick={onRemove}
      aria-label={`删除${label}`}
    >
      删除
    </button>
  );
}

function PreviewSection({
  title,
  children,
}: Readonly<{ title: string; children: ReactNode }>): ReactElement {
  return (
    <section className={styles['resume-preview-section']}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function PreviewEntries({
  entries,
}: Readonly<{
  entries: readonly { title: string; meta?: string; detail?: readonly string[] }[];
}>): ReactElement {
  return (
    <div className={styles['resume-preview-entries']}>
      {entries.map((entry, index) => (
        <article key={`${entry.title}-${String(index)}`}>
          <div>
            <strong>{entry.title}</strong>
            {entry.meta ? <span>{entry.meta}</span> : null}
          </div>
          {entry.detail?.length ? (
            <ul>
              {entry.detail.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function ResumePreview({ draft: source }: Readonly<{ draft: Draft }>): ReactElement {
  const draft = cleanDraft(source);
  const basic = [
    draft.basicInfo.phone,
    draft.basicInfo.email,
    draft.basicInfo.location,
    draft.basicInfo.website,
  ].filter(filled);
  const intentions = [
    ...draft.targetRoles,
    ...draft.preferences.locations,
    ...draft.preferences.employmentTypes,
  ];
  return (
    <article className={styles['resume-preview-paper']}>
      {filled(draft.basicInfo.name) || basic.length ? (
        <header className={styles['resume-preview-person']}>
          <div>
            <p className="eyebrow">CANDIDATE PROFILE</p>
            {filled(draft.basicInfo.name) ? <h2>{draft.basicInfo.name}</h2> : null}
          </div>
          {basic.length ? <p>{basic.join(' · ')}</p> : null}
        </header>
      ) : null}
      {intentions.length ? (
        <PreviewSection title="求职意向">
          <p>{intentions.join(' · ')}</p>
        </PreviewSection>
      ) : null}
      {draft.education.length ? (
        <PreviewSection title="教育经历">
          <PreviewEntries
            entries={draft.education.map((item) => ({
              title: item.institution ?? '',
              meta: [
                item.degree,
                item.field,
                item.startDate && item.endDate
                  ? `${item.startDate} — ${item.endDate}`
                  : (item.startDate ?? item.endDate),
              ]
                .filter(filled)
                .join(' · '),
            }))}
          />
        </PreviewSection>
      ) : null}
      {draft.workExperience.length ? (
        <PreviewSection title="实习与工作经历">
          <PreviewEntries
            entries={draft.workExperience.map((item) => ({
              title: [item.organization, item.title].filter(filled).join(' · '),
              meta: [item.startDate, item.endDate].filter(filled).join(' — '),
              detail: item.highlights,
            }))}
          />
        </PreviewSection>
      ) : null}
      {draft.projects.length ? (
        <PreviewSection title="项目经历">
          <PreviewEntries
            entries={draft.projects.map((item) => ({
              title: item.name,
              meta: [item.role, [item.startDate, item.endDate].filter(filled).join(' — ')]
                .filter(filled)
                .join(' · '),
              detail: item.highlights,
            }))}
          />
        </PreviewSection>
      ) : null}
      {draft.works.length ? (
        <PreviewSection title="作品">
          <PreviewEntries
            entries={draft.works.map((item) => ({
              title: item.name,
              ...(item.url ? { meta: item.url } : {}),
              detail: filled(item.description) ? [item.description] : [],
            }))}
          />
        </PreviewSection>
      ) : null}
      {draft.competitions.length ? (
        <PreviewSection title="竞赛">
          <PreviewEntries
            entries={draft.competitions.map((item) => ({
              title: item.name,
              meta: [item.award, item.date].filter(filled).join(' · '),
            }))}
          />
        </PreviewSection>
      ) : null}
      {draft.certificates.length ? (
        <PreviewSection title="证书">
          <PreviewEntries
            entries={draft.certificates.map((item) => ({
              title: item.name,
              meta: [item.issuer, item.date].filter(filled).join(' · '),
            }))}
          />
        </PreviewSection>
      ) : null}
      {draft.languages.length ? (
        <PreviewSection title="语言能力">
          <p>
            {draft.languages
              .map((item) => [item.name, item.proficiency].filter(filled).join(' · '))
              .join('　')}
          </p>
        </PreviewSection>
      ) : null}
      {filled(draft.professionalSkills) ? (
        <PreviewSection title="专业技能">
          <p className={styles['resume-preview-copy']}>{draft.professionalSkills}</p>
        </PreviewSection>
      ) : null}
      {filled(draft.selfEvaluation) ? (
        <PreviewSection title="自我评价">
          <p className={styles['resume-preview-copy']}>{draft.selfEvaluation}</p>
        </PreviewSection>
      ) : null}
    </article>
  );
}

function PreviewDialog({
  draft,
  onClose,
}: Readonly<{ draft: Draft; onClose: () => void }>): ReactElement {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus();
    const keydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab' || !panel.current) return;
      const focusable = [
        ...panel.current.querySelectorAll<HTMLElement>(
          'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])',
        ),
      ].filter((element) => !element.hasAttribute('disabled'));
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === panel.current)
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', keydown);
    };
  }, [onClose]);
  return createPortal(
    <div className={styles['resume-preview-backdrop']} data-resume-preview-backdrop>
      <div
        ref={panel}
        className={styles['resume-preview-dialog']}
        data-resume-preview-dialog
        role="dialog"
        aria-modal="true"
        aria-labelledby="resume-preview-title"
        tabIndex={-1}
      >
        <header>
          <div>
            <p className="eyebrow">RESUME PREVIEW</p>
            <h2 id="resume-preview-title">简历预览</h2>
          </div>
          <button type="button" className="button-muted" onClick={onClose}>
            关闭预览
          </button>
        </header>
        <div className={styles['resume-preview-scroll']} data-resume-preview-scroll>
          <ResumePreview draft={draft} />
        </div>
        <footer>
          <span>空白章节已自动隐藏</span>
          <button type="button" className="button-secondary" onClick={onClose}>
            返回编辑
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

export function ResumeEditor({
  profileId,
  versionId,
  profile,
}: Readonly<{ profileId: string; versionId: string; profile: Draft }>): ReactElement {
  const [draft, setDraft] = useState<Draft>(() => prepareDraft(profile));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [preview, setPreview] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(
    null,
  );
  const previewButton = useRef<HTMLButtonElement>(null);
  const allowUnload = useRef(false);
  const dirty =
    !saved &&
    JSON.stringify(cleanDraft(draft)) !== JSON.stringify(cleanDraft(prepareDraft(profile)));

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent): void => {
      if (allowUnload.current) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [dirty]);

  const updateArray = <K extends keyof Draft>(key: K, value: Draft[K]): void => {
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const save = async (event: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      const response = await fetch('/api/profile', {
        method: 'PATCH',
        headers: await mutationHeaders(),
        body: JSON.stringify({
          kind: 'replace',
          profileId,
          expectedVersionId: versionId,
          profile: cleanDraft(draft),
        }),
      });
      const body = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? '结构化简历保存失败。');
      allowUnload.current = true;
      setSaved(true);
      setFeedback({ kind: 'success', text: '结构化简历已保存为新版本。' });
      window.location.reload();
    } catch (error) {
      setFeedback({
        kind: 'error',
        text: error instanceof Error ? error.message : '结构化简历保存失败。',
      });
      setBusy(false);
    }
  };
  const closePreview = (): void => {
    setPreview(false);
    window.setTimeout(() => previewButton.current?.focus(), 0);
  };

  return (
    <form
      className={classNames(styles['structured-resume'], styles['resume-editor-form'])}
      data-resume-editor
      onSubmit={(event) => {
        void save(event);
      }}
      noValidate
    >
      <header className={styles['structured-resume-heading']} data-resume-editor-heading>
        <div>
          <p className="eyebrow">ONLINE RESUME</p>
          <h2>在线简历</h2>
          <p className="muted">逐项核对解析结果，保存后生成新的画像版本。</p>
        </div>
        <span className="status status-succeeded">可编辑</span>
      </header>
      <nav
        className={styles['resume-edit-outline']}
        data-resume-edit-outline
        aria-label="在线简历章节"
      >
        {(
          [
            ['resume-basic', '基本信息'],
            ['resume-intention', '求职意向'],
            ['resume-education', '教育经历'],
            ['resume-work', '工作经历'],
            ['resume-projects', '项目经历'],
            ['resume-works', '作品'],
            ['resume-competitions', '竞赛'],
            ['resume-certificates', '证书'],
            ['resume-languages', '语言能力'],
            ['resume-skills', '专业技能'],
            ['resume-evaluation', '自我评价'],
          ] as const
        ).map(([href, label]) => (
          <a key={href} href={`#${href}`}>
            {label}
          </a>
        ))}
      </nav>

      <div className={styles['resume-edit-document']}>
        <EditorSection
          id="resume-basic"
          title="基本信息"
          description="用于简历抬头和联系，请确认信息准确。"
        >
          <div className={styles['resume-field-grid']}>
            <Field
              label="姓名"
              value={draft.basicInfo.name}
              onChange={(name) => {
                setDraft((current) => ({ ...current, basicInfo: { ...current.basicInfo, name } }));
              }}
              placeholder="请输入姓名"
            />
            <Field
              label="手机号码"
              type="tel"
              value={draft.basicInfo.phone}
              onChange={(phone) => {
                setDraft((current) => ({ ...current, basicInfo: { ...current.basicInfo, phone } }));
              }}
            />
            <Field
              label="邮箱"
              type="email"
              value={draft.basicInfo.email}
              onChange={(email) => {
                setDraft((current) => ({ ...current, basicInfo: { ...current.basicInfo, email } }));
              }}
            />
            <Field
              label="所在城市"
              value={draft.basicInfo.location}
              onChange={(location) => {
                setDraft((current) => ({
                  ...current,
                  basicInfo: { ...current.basicInfo, location },
                }));
              }}
            />
            <Field
              label="个人主页"
              type="url"
              value={draft.basicInfo.website}
              onChange={(website) => {
                setDraft((current) => ({
                  ...current,
                  basicInfo: { ...current.basicInfo, website },
                }));
              }}
            />
          </div>
        </EditorSection>

        <EditorSection
          id="resume-intention"
          title="求职意向"
          description="用于职位筛选和匹配排序。"
        >
          <div className={styles['resume-field-grid']}>
            <label>
              目标岗位
              <input
                value={draft.targetRoles.join('，')}
                onChange={(event) => {
                  updateArray('targetRoles', list(event.currentTarget.value));
                }}
                placeholder="多个岗位用逗号分隔"
              />
            </label>
            <label>
              期望地点
              <input
                value={draft.preferences.locations.join('，')}
                onChange={(event) => {
                  setDraft((current) => ({
                    ...current,
                    preferences: {
                      ...current.preferences,
                      locations: list(event.currentTarget.value),
                    },
                  }));
                }}
              />
            </label>
            <label>
              用工类型
              <input
                value={draft.preferences.employmentTypes.join('，')}
                onChange={(event) => {
                  setDraft((current) => ({
                    ...current,
                    preferences: {
                      ...current.preferences,
                      employmentTypes: list(event.currentTarget.value),
                    },
                  }));
                }}
              />
            </label>
            <label>
              排除关键词
              <input
                value={draft.preferences.excludedTerms.join('，')}
                onChange={(event) => {
                  setDraft((current) => ({
                    ...current,
                    preferences: {
                      ...current.preferences,
                      excludedTerms: list(event.currentTarget.value),
                    },
                  }));
                }}
              />
            </label>
            <label>
              接受远程
              <select
                value={
                  draft.preferences.remoteAccepted === null
                    ? 'unknown'
                    : String(draft.preferences.remoteAccepted)
                }
                onChange={(event) => {
                  setDraft((current) => ({
                    ...current,
                    preferences: {
                      ...current.preferences,
                      remoteAccepted:
                        event.currentTarget.value === 'unknown'
                          ? null
                          : event.currentTarget.value === 'true',
                    },
                  }));
                }}
              >
                <option value="unknown">未设置</option>
                <option value="true">接受</option>
                <option value="false">不接受</option>
              </select>
            </label>
            <label>
              经验年限
              <input
                type="number"
                min="0"
                step="0.5"
                value={draft.yearsOfExperience ?? ''}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  updateArray('yearsOfExperience', value ? Number(value) : null);
                }}
              />
            </label>
            <label>
              管理经验
              <select
                value={
                  draft.managementExperience === null
                    ? 'unknown'
                    : String(draft.managementExperience)
                }
                onChange={(event) => {
                  updateArray(
                    'managementExperience',
                    event.currentTarget.value === 'unknown'
                      ? null
                      : event.currentTarget.value === 'true',
                  );
                }}
              >
                <option value="unknown">未设置</option>
                <option value="true">有</option>
                <option value="false">无</option>
              </select>
            </label>
            <fieldset
              className={classNames(styles['resume-checkbox-group'], styles['resume-wide-field'])}
            >
              <legend>期望公司规模</legend>
              {(
                [
                  ['large', '大型企业'],
                  ['medium', '中型企业'],
                  ['other', '其他规模'],
                ] as const
              ).map(([value, label]) => (
                <label key={value}>
                  <input
                    type="checkbox"
                    checked={draft.preferences.companySizes.includes(value)}
                    onChange={(event) => {
                      setDraft((current) => ({
                        ...current,
                        preferences: {
                          ...current.preferences,
                          companySizes: event.currentTarget.checked
                            ? [...current.preferences.companySizes, value]
                            : current.preferences.companySizes.filter((item) => item !== value),
                        },
                      }));
                    }}
                  />
                  {label}
                </label>
              ))}
            </fieldset>
          </div>
        </EditorSection>

        <EditorSection
          id="resume-education"
          title="教育经历"
          description="按时间倒序填写学校、学历与专业。"
        >
          <Repeater
            title="教育经历"
            count={draft.education.length}
            onAdd={() => {
              updateArray('education', [
                ...draft.education,
                {
                  institution: null,
                  degree: null,
                  field: null,
                  startDate: null,
                  endDate: null,
                  evidence: emptyEvidence(),
                },
              ]);
            }}
          >
            {draft.education.map((item, index) => (
              <div className={styles['resume-edit-entry']} key={index}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <div className={styles['resume-field-grid']}>
                  <Field
                    label="学校"
                    value={item.institution}
                    onChange={(institution) => {
                      const next = [...draft.education];
                      next[index] = { ...item, institution };
                      updateArray('education', next);
                    }}
                  />
                  <Field
                    label="学历"
                    value={item.degree}
                    onChange={(degree) => {
                      const next = [...draft.education];
                      next[index] = { ...item, degree };
                      updateArray('education', next);
                    }}
                  />
                  <Field
                    label="专业"
                    value={item.field}
                    onChange={(field) => {
                      const next = [...draft.education];
                      next[index] = { ...item, field };
                      updateArray('education', next);
                    }}
                  />
                  <DateRangeField
                    start={item.startDate}
                    end={item.endDate}
                    onStartChange={(startDate) => {
                      const next = [...draft.education];
                      next[index] = { ...item, startDate };
                      updateArray('education', next);
                    }}
                    onEndChange={(endDate) => {
                      const next = [...draft.education];
                      next[index] = { ...item, endDate };
                      updateArray('education', next);
                    }}
                  />
                </div>
                <RemoveButton
                  label={`第 ${String(index + 1)} 段教育经历`}
                  onRemove={() => {
                    updateArray(
                      'education',
                      draft.education.filter((_, position) => position !== index),
                    );
                  }}
                />
              </div>
            ))}
          </Repeater>
        </EditorSection>

        <ExperienceEditor
          id="resume-work"
          title="实习与工作经历"
          description="突出职责、产出与可量化结果。"
          entries={draft.workExperience}
          onChange={(value) => {
            updateArray('workExperience', value);
          }}
        />
        <ProjectEditor
          entries={draft.projects}
          onChange={(value) => {
            updateArray('projects', value);
          }}
        />
        <SimpleRepeater
          id="resume-works"
          title="作品"
          description="填写作品、代码仓库或可公开访问的成果。"
          itemLabel="作品"
          items={draft.works}
          fields={[
            ['name', '作品名称'],
            ['description', '作品说明'],
            ['url', '作品链接'],
          ]}
          onChange={(value) => {
            updateArray('works', value as Draft['works']);
          }}
        />
        <SimpleRepeater
          id="resume-competitions"
          title="竞赛"
          description="记录竞赛名称、奖项和时间。"
          itemLabel="竞赛"
          items={draft.competitions}
          fields={[
            ['name', '竞赛名称'],
            ['award', '奖项'],
            ['date', '获奖时间'],
          ]}
          onChange={(value) => {
            updateArray('competitions', value as Draft['competitions']);
          }}
        />
        <SimpleRepeater
          id="resume-certificates"
          title="证书"
          description="记录职业、技术或语言类证书。"
          itemLabel="证书"
          items={draft.certificates}
          fields={[
            ['name', '证书名称'],
            ['issuer', '颁发机构'],
            ['date', '取得时间'],
          ]}
          onChange={(value) => {
            updateArray('certificates', value as Draft['certificates']);
          }}
        />
        <SimpleRepeater
          id="resume-languages"
          title="语言能力"
          description="填写语言及听说读写水平或考试成绩。"
          itemLabel="语言"
          items={draft.languages}
          fields={[
            ['name', '语言'],
            ['proficiency', '熟练程度 / 成绩'],
          ]}
          onChange={(value) => {
            updateArray('languages', value as Draft['languages']);
          }}
        />

        <EditorSection
          id="resume-skills"
          title="专业技能"
          description="用一段连贯文字说明技术栈、工具、专业领域和掌握程度。"
        >
          <label>
            专业技能
            <textarea
              className={classNames('resize-none', styles['resume-professional-skills'])}
              rows={8}
              value={draft.professionalSkills ?? ''}
              onChange={(event) => {
                updateArray('professionalSkills', text(event.currentTarget.value));
              }}
              placeholder="例如：熟练使用 TypeScript 与 React，具备大模型应用、Agent 工作流和评测体系建设经验……"
            />
          </label>
        </EditorSection>
        <EditorSection
          id="resume-evaluation"
          title="自我评价"
          description="用简洁事实总结优势、方向与工作方式。"
        >
          <label>
            自我评价
            <textarea
              className="resize-none"
              rows={7}
              value={draft.selfEvaluation ?? ''}
              onChange={(event) => {
                updateArray('selfEvaluation', text(event.currentTarget.value));
              }}
              placeholder="建议控制在 200–400 字"
            />
          </label>
        </EditorSection>
      </div>

      {feedback ? (
        <p
          className={`form-feedback ${feedback.kind}`}
          role={feedback.kind === 'error' ? 'alert' : 'status'}
        >
          {feedback.text}
        </p>
      ) : null}
      <footer className={styles['resume-editor-actions']} data-resume-editor-actions>
        <span>{dirty ? '有尚未保存的修改' : '保存会创建新的画像版本'}</span>
        <div>
          <button
            ref={previewButton}
            type="button"
            className="button-secondary"
            onClick={() => {
              setPreview(true);
            }}
          >
            预览
          </button>
          <button type="submit" disabled={busy}>
            {busy ? '正在保存…' : '保存简历'}
          </button>
        </div>
      </footer>
      {preview ? <PreviewDialog draft={draft} onClose={closePreview} /> : null}
    </form>
  );
}

function ExperienceEditor({
  id,
  title,
  description,
  entries,
  onChange,
}: Readonly<{
  id: string;
  title: string;
  description: string;
  entries: readonly Experience[];
  onChange: (value: Experience[]) => void;
}>): ReactElement {
  return (
    <EditorSection id={id} title={title} description={description}>
      <Repeater
        title="经历"
        count={entries.length}
        onAdd={() => {
          onChange([
            ...entries,
            {
              organization: null,
              title: '待填写职位',
              startDate: null,
              endDate: null,
              highlights: [],
              evidence: emptyEvidence(),
            },
          ]);
        }}
      >
        {entries.map((item, index) => (
          <div className={styles['resume-edit-entry']} key={index}>
            <span>{String(index + 1).padStart(2, '0')}</span>
            <div className={styles['resume-field-grid']}>
              <Field
                label="公司 / 组织"
                value={item.organization}
                onChange={(organization) => {
                  const next = [...entries];
                  next[index] = { ...item, organization };
                  onChange(next);
                }}
              />
              <label>
                职位
                <input
                  value={item.title}
                  onChange={(event) => {
                    const next = [...entries];
                    next[index] = { ...item, title: event.currentTarget.value };
                    onChange(next);
                  }}
                />
              </label>
              <DateRangeField
                start={item.startDate}
                end={item.endDate}
                onStartChange={(startDate) => {
                  const next = [...entries];
                  next[index] = { ...item, startDate };
                  onChange(next);
                }}
                onEndChange={(endDate) => {
                  const next = [...entries];
                  next[index] = { ...item, endDate };
                  onChange(next);
                }}
              />
              <label className={styles['resume-wide-field']}>
                成果与职责
                <textarea
                  className="resize-none"
                  rows={4}
                  value={item.highlights.join('\n')}
                  onChange={(event) => {
                    const next = [...entries];
                    next[index] = { ...item, highlights: list(event.currentTarget.value) };
                    onChange(next);
                  }}
                />
              </label>
            </div>
            <RemoveButton
              label={`第 ${String(index + 1)} 段工作经历`}
              onRemove={() => {
                onChange(entries.filter((_, position) => position !== index));
              }}
            />
          </div>
        ))}
      </Repeater>
    </EditorSection>
  );
}

function ProjectEditor({
  entries,
  onChange,
}: Readonly<{ entries: readonly Project[]; onChange: (value: Project[]) => void }>): ReactElement {
  return (
    <EditorSection
      id="resume-projects"
      title="项目经历"
      description="说明项目目标、个人角色和结果。"
    >
      <Repeater
        title="项目"
        count={entries.length}
        onAdd={() => {
          onChange([
            ...entries,
            {
              name: '待填写项目',
              role: null,
              startDate: null,
              endDate: null,
              highlights: [],
              evidence: emptyEvidence(),
            },
          ]);
        }}
      >
        {entries.map((item, index) => (
          <div className={styles['resume-edit-entry']} key={index}>
            <span>{String(index + 1).padStart(2, '0')}</span>
            <div className={styles['resume-field-grid']}>
              <label>
                项目名称
                <input
                  value={item.name}
                  onChange={(event) => {
                    const next = [...entries];
                    next[index] = { ...item, name: event.currentTarget.value };
                    onChange(next);
                  }}
                />
              </label>
              <Field
                label="项目角色"
                value={item.role}
                onChange={(role) => {
                  const next = [...entries];
                  next[index] = { ...item, role };
                  onChange(next);
                }}
              />
              <DateRangeField
                start={item.startDate}
                end={item.endDate}
                onStartChange={(startDate) => {
                  const next = [...entries];
                  next[index] = { ...item, startDate };
                  onChange(next);
                }}
                onEndChange={(endDate) => {
                  const next = [...entries];
                  next[index] = { ...item, endDate };
                  onChange(next);
                }}
              />
              <label className={styles['resume-wide-field']}>
                项目描述
                <textarea
                  className="resize-none"
                  rows={4}
                  value={item.highlights.join('\n')}
                  onChange={(event) => {
                    const next = [...entries];
                    next[index] = { ...item, highlights: list(event.currentTarget.value) };
                    onChange(next);
                  }}
                />
              </label>
            </div>
            <RemoveButton
              label={`第 ${String(index + 1)} 个项目`}
              onRemove={() => {
                onChange(entries.filter((_, position) => position !== index));
              }}
            />
          </div>
        ))}
      </Repeater>
    </EditorSection>
  );
}

type SimpleItem = Record<string, string | null>;
function SimpleRepeater({
  id,
  title,
  description,
  itemLabel,
  items,
  fields,
  onChange,
}: Readonly<{
  id: string;
  title: string;
  description: string;
  itemLabel: string;
  items: readonly SimpleItem[];
  fields: readonly (readonly [string, string])[];
  onChange: (value: SimpleItem[]) => void;
}>): ReactElement {
  return (
    <EditorSection id={id} title={title} description={description}>
      <Repeater
        title={itemLabel}
        count={items.length}
        onAdd={() => {
          onChange([
            ...items,
            Object.fromEntries(
              fields.map(([key]) => [key, key === 'name' ? `待填写${itemLabel}` : null]),
            ),
          ]);
        }}
      >
        {items.map((item, index) => (
          <div className={styles['resume-edit-entry']} key={index}>
            <span>{String(index + 1).padStart(2, '0')}</span>
            <div className={styles['resume-field-grid']}>
              {fields.map(([key, label]) => (
                <Field
                  key={key}
                  label={label}
                  type={key === 'date' ? 'date' : 'text'}
                  value={item[key] ?? null}
                  onChange={(value) => {
                    const next = [...items];
                    next[index] = { ...item, [key]: value };
                    onChange(next);
                  }}
                />
              ))}
            </div>
            <RemoveButton
              label={`第 ${String(index + 1)} 项${itemLabel}`}
              onRemove={() => {
                onChange(items.filter((_, position) => position !== index));
              }}
            />
          </div>
        ))}
      </Repeater>
    </EditorSection>
  );
}
