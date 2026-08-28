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
  const [sourceSyncChannel, setSourceSyncChannel] = useState(settings.sourceSync.channel);
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
        body: JSON.stringify({ jobUnderstandingEnabled: enabled, sourceSyncChannel }),
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
      <fieldset className={styles.channelFieldset}>
        <legend>同步招聘渠道</legend>
        <p className={styles.fieldHelp}>
          系统一次只同步一种招聘渠道。切换后，旧渠道尚未执行的同步任务会取消。
        </p>
        <div className={styles.channelOptions}>
          {(
            [
              ['intern', '实习', '默认，优先同步日常实习和项目实习岗位'],
              ['campus', '校招', '同步应届毕业生和校园招聘正式岗位'],
              ['social', '社招', '同步面向有工作经验候选人的岗位'],
            ] as const
          ).map(([value, label, description]) => (
            <label className={styles.channelOption} key={value}>
              <input
                type="radio"
                name="source-sync-channel"
                value={value}
                checked={sourceSyncChannel === value}
                onChange={() => {
                  setSourceSyncChannel(value);
                }}
              />
              <span>
                <strong>{label}</strong>
                <small>{description}</small>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
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
