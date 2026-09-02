'use client';

import { resumeTemplates, type ResumeTemplateKey } from '@jobhunter/resume-template';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { mutationHeaders } from '../../src/client/csrf.js';
import { SelectField } from '../components/select-field.js';
import styles from './resume-template-entry.module.css';

export function ResumeTemplateEntry({ profileId }: Readonly<{ profileId: string }>): ReactElement {
  const [templateKey, setTemplateKey] = useState<ResumeTemplateKey>('technical-blueprint');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openStudio = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/resume-drafts', {
        method: 'POST',
        headers: await mutationHeaders(),
        body: JSON.stringify({ profileId, templateKey }),
      });
      const body = (await response.json()) as {
        data?: { draft?: { id?: string } };
        error?: { message?: string };
      };
      if (!response.ok || !body.data?.draft?.id)
        throw new Error(body.error?.message ?? '无法打开简历制作页。');
      window.location.assign(`/resume-studio/${body.data.draft.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法打开简历制作页。');
      setBusy(false);
    }
  };

  return (
    <div className={styles.root} data-resume-template-entry>
      <SelectField
        name="resumeTemplate"
        label="简历模板"
        value={templateKey}
        options={resumeTemplates.map((template) => ({ value: template.key, label: template.name }))}
        onValueChange={(value) => {
          setTemplateKey(value as ResumeTemplateKey);
        }}
      />
      <button
        type="button"
        className="button-secondary"
        disabled={busy}
        aria-busy={busy}
        onClick={() => void openStudio()}
      >
        {busy ? '正在打开…' : '导出'}
      </button>
      {error ? (
        <span className={styles.error} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
