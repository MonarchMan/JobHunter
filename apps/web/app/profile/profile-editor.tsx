'use client';

import type { WebProfileDetail, WebProfileMutation } from '@jobhunter/application/web';
import type { ReactElement, SyntheticEvent } from 'react';
import { useState } from 'react';
import { mutationHeaders } from '../../src/client/csrf.js';
import { SelectField } from '../components/select-field.js';
import { useToast } from '../components/toast-provider.js';
import styles from './profile-editor.module.css';

interface ApiFailure {
  readonly error?: { readonly message?: string };
}

function commaList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function ProfileEditor({ detail }: Readonly<{ detail: WebProfileDetail }>): ReactElement {
  const { showToastAfterReload } = useToast();
  const preferences = detail.current.effective.preferences;
  const [pointer, setPointer] = useState('/preferences/locations');
  const [jsonValue, setJsonValue] = useState(JSON.stringify(preferences.locations));
  const [locations, setLocations] = useState(preferences.locations.join(','));
  const [companySizes, setCompanySizes] = useState(preferences.companySizes.join(','));
  const [employmentTypes, setEmploymentTypes] = useState(preferences.employmentTypes.join(','));
  const [excludedTerms, setExcludedTerms] = useState(preferences.excludedTerms.join(','));
  const [remoteAccepted, setRemoteAccepted] = useState(
    preferences.remoteAccepted === null ? 'unknown' : String(preferences.remoteAccepted),
  );
  const [feedback, setFeedback] = useState<{ kind: 'error' | 'success'; text: string } | null>(
    null,
  );
  const [submitting, setSubmitting] = useState(false);

  const mutate = async (mutation: WebProfileMutation): Promise<void> => {
    setSubmitting(true);
    setFeedback(null);
    try {
      const response = await fetch('/api/profile', {
        method: 'PATCH',
        headers: await mutationHeaders(),
        body: JSON.stringify(mutation),
      });
      const body = (await response.json()) as ApiFailure;
      if (!response.ok) throw new Error(body.error?.message ?? '个人资料修改失败。');
      showToastAfterReload('已创建新的个人资料版本。');
      window.location.reload();
    } catch (error) {
      setFeedback({
        kind: 'error',
        text: error instanceof Error ? error.message : '个人资料修改失败。',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const correction = (event: SyntheticEvent<HTMLFormElement>): void => {
    event.preventDefault();
    try {
      const value = JSON.parse(jsonValue) as unknown;
      void mutate({
        kind: 'set',
        profileId: detail.profile.id,
        expectedVersionId: detail.current.id,
        pointer,
        value,
      });
    } catch {
      setFeedback({ kind: 'error', text: '字段值必须是有效 JSON。' });
    }
  };

  const savePreferences = (event: SyntheticEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void mutate({
      kind: 'preferences',
      profileId: detail.profile.id,
      expectedVersionId: detail.current.id,
      preferences: {
        locations: commaList(locations),
        companySizes: commaList(companySizes) as ('large' | 'medium' | 'other')[],
        employmentTypes: commaList(employmentTypes),
        excludedTerms: commaList(excludedTerms),
        remoteAccepted: remoteAccepted === 'unknown' ? null : remoteAccepted === 'true',
      },
    });
  };

  const lockMutation = (kind: 'lock' | 'unlock', lockPointer: string): void => {
    void mutate({
      kind,
      profileId: detail.profile.id,
      expectedVersionId: detail.current.id,
      pointer: lockPointer,
    });
  };

  return (
    <section className={styles.root} aria-labelledby="profile-editor-title">
      <div className="section-heading">
        <h2 id="profile-editor-title">人工维护</h2>
      </div>
      {feedback ? (
        <p className={`form-feedback ${feedback.kind}`} role="status">
          {feedback.text}
        </p>
      ) : null}
      <div className={styles.grid}>
        <form
          className={['panel-block', styles.stack].join(' ')}
          onSubmit={savePreferences}
          noValidate
        >
          <h3>求职偏好</h3>
          <label>
            目标地点（逗号分隔）
            <input
              value={locations}
              onChange={(event) => {
                setLocations(event.target.value);
              }}
            />
          </label>
          <label>
            公司规模（large,medium,other）
            <input
              value={companySizes}
              onChange={(event) => {
                setCompanySizes(event.target.value);
              }}
            />
          </label>
          <label>
            用工类型（逗号分隔）
            <input
              value={employmentTypes}
              onChange={(event) => {
                setEmploymentTypes(event.target.value);
              }}
            />
          </label>
          <label>
            排除词（逗号分隔）
            <input
              value={excludedTerms}
              onChange={(event) => {
                setExcludedTerms(event.target.value);
              }}
            />
          </label>
          <label>
            接受远程
            <SelectField
              name="preferencesRemoteAccepted"
              label="接受远程"
              options={[
                { value: 'unknown', label: '未设置' },
                { value: 'true', label: '是' },
                { value: 'false', label: '否' },
              ]}
              value={remoteAccepted}
              onValueChange={setRemoteAccepted}
            />
          </label>
          <button type="submit" disabled={submitting}>
            保存偏好
          </button>
        </form>
        <form className={['panel-block', styles.stack].join(' ')} onSubmit={correction} noValidate>
          <h3>字段修正</h3>
          <label>
            JSON Pointer
            <input
              value={pointer}
              onChange={(event) => {
                setPointer(event.target.value);
              }}
              required
            />
          </label>
          <label>
            JSON 值
            <textarea
              className="resize-none"
              value={jsonValue}
              onChange={(event) => {
                setJsonValue(event.target.value);
              }}
              rows={6}
              required
            />
          </label>
          <div className="inline-actions">
            <button type="submit" disabled={submitting}>
              创建修正版
            </button>
            <button
              type="button"
              className="button-muted"
              disabled={submitting}
              onClick={() => {
                lockMutation('lock', pointer);
              }}
            >
              锁定字段
            </button>
          </div>
        </form>
      </div>
      <div className={['panel-block', styles.lockedPaths].join(' ')}>
        <h3>已锁定字段</h3>
        {detail.current.lockedPaths.length === 0 ? (
          <p className="muted">暂无锁定字段。</p>
        ) : (
          <ul>
            {detail.current.lockedPaths.map((path) => (
              <li key={path}>
                <code>{path}</code>
                <button
                  type="button"
                  className="button-link"
                  disabled={submitting}
                  onClick={() => {
                    lockMutation('unlock', path);
                  }}
                >
                  解锁
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
