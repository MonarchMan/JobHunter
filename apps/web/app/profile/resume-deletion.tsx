'use client';

import type { WebResumeDeletionImpact } from '@jobhunter/application/web';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { mutationHeaders } from '../../src/client/csrf.js';
import styles from './resume-deletion.module.css';
import { useToast } from '../components/toast-provider.js';

interface ApiEnvelope<T> {
  readonly data?: T;
  readonly error?: { readonly message?: string };
}

export function ResumeDeletion({
  resumeDocumentId,
}: Readonly<{ resumeDocumentId: string }>): ReactElement {
  const [impact, setImpact] = useState<WebResumeDeletionImpact | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [token] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);

  const preview = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/resumes/${resumeDocumentId}/deletion`, {
        cache: 'no-store',
      });
      const body = (await response.json()) as ApiEnvelope<WebResumeDeletionImpact>;
      if (!response.ok || !body.data) throw new Error(body.error?.message ?? '无法生成删除预览。');
      setImpact(body.data);
    } catch (error) {
      setError(error instanceof Error ? error.message : '无法生成删除预览。');
    } finally {
      setBusy(false);
    }
  };

  const submitDeletion = async (): Promise<void> => {
    if (!impact || confirmation !== 'DELETE') return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/resumes/${resumeDocumentId}/deletion`, {
        method: 'POST',
        headers: await mutationHeaders(),
        body: JSON.stringify({
          expectedImpactHash: impact.impactHash,
          confirmation,
          idempotencyToken: token,
        }),
      });
      const body = (await response.json()) as ApiEnvelope<{ readonly taskId: string }>;
      if (!response.ok || !body.data) throw new Error(body.error?.message ?? '无法创建删除任务。');
      showToast('敏感数据删除任务已创建。');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '无法创建删除任务。', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.root} aria-labelledby="delete-resume-heading">
      <h2 id="delete-resume-heading">敏感数据删除</h2>
      <p>先生成影响预览；预览不会修改数据。真正删除由 Worker 执行且不可撤销。</p>
      {!impact ? (
        <button
          type="button"
          className="button-danger"
          disabled={busy}
          onClick={() => void preview()}
        >
          预览删除影响
        </button>
      ) : (
        <div className={styles.preview}>
          <ul>
            {Object.entries(impact.counts).map(([name, count]) => (
              <li key={name}>
                {name}: {count}
              </li>
            ))}
          </ul>
          {impact.warnings.map((warning) => (
            <p className="risk" key={warning}>
              {warning}
            </p>
          ))}
          <label>
            输入 DELETE 进行二次确认
            <input
              value={confirmation}
              onChange={(event) => {
                setConfirmation(event.target.value);
              }}
            />
          </label>
          <button
            type="button"
            className="button-danger"
            disabled={busy || confirmation !== 'DELETE'}
            onClick={() => void submitDeletion()}
          >
            确认并创建删除任务
          </button>
        </div>
      )}
      {error ? (
        <p className="form-feedback error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
