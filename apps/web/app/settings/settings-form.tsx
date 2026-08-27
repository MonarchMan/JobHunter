'use client';

import type { SystemSettings } from '@jobhunter/application/web';
import type { ReactElement, SyntheticEvent } from 'react';
import { useState } from 'react';
import { mutationHeaders } from '../../src/client/csrf.js';
import styles from './settings.module.css';

interface SettingsFormProperties {
  readonly settings: SystemSettings;
}

interface ApiFailure {
  readonly error?: { readonly message?: string };
}

export function SettingsForm({ settings }: SettingsFormProperties): ReactElement {
  const [enabled, setEnabled] = useState(settings.jobUnderstanding.enabled);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  const submit = async (event: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      const response = await fetch('/api/settings', {
        method: 'PATCH',
        headers: await mutationHeaders(),
        body: JSON.stringify({ jobUnderstandingEnabled: enabled }),
      });
      const body = (await response.json()) as ApiFailure;
      if (!response.ok) throw new Error(body.error?.message ?? '设置保存失败。');
      setFeedback({ kind: 'success', text: '设置已保存。' });
    } catch (error) {
      setFeedback({
        kind: 'error',
        text: error instanceof Error ? error.message : '设置保存失败。',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className={styles.settingsForm}
      onSubmit={(event) => {
        void submit(event);
      }}
      noValidate
    >
      <label className={styles.settingsToggle}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => {
            setEnabled(event.target.checked);
          }}
        />
        <span>
          <strong>自动执行职位理解</strong>
          <small>{enabled ? '已开启' : '已关闭'}</small>
        </span>
      </label>
      <div className="inline-actions">
        <button type="submit" disabled={busy}>
          {busy ? '保存中…' : '保存设置'}
        </button>
      </div>
      {feedback ? (
        <p
          className={`form-feedback ${feedback.kind}`}
          role={feedback.kind === 'error' ? 'alert' : 'status'}
        >
          {feedback.text}
        </p>
      ) : null}
    </form>
  );
}
