'use client';

import type { DragEvent, ReactElement, SyntheticEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation.js';
import { mutationHeaders } from '../../src/client/csrf.js';
import styles from './resume-import.module.css';

interface ImportResponse {
  readonly data?: {
    readonly document?: { readonly parseStatus?: string; readonly errorSummary?: string | null };
    readonly task?: { readonly taskId?: string } | null;
  };
  readonly error?: { readonly message?: string };
}

interface TaskResponse {
  readonly data?: {
    readonly status?: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
    readonly errorSummary?: string | null;
  };
}

export function ResumeImport({ profileId }: Readonly<{ profileId?: string }>): ReactElement {
  const router = useRouter();
  const formReference = useRef<HTMLFormElement>(null);
  const taskAbortReference = useRef<AbortController | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);

  useEffect(
    () => () => {
      taskAbortReference.current?.abort();
    },
    [],
  );

  const chooseFile = (file: File | undefined): void => {
    setFileName(file && file.size > 0 ? file.name : null);
    if (file) setError(null);
  };

  const trackTask = async (taskId: string): Promise<void> => {
    taskAbortReference.current?.abort();
    const controller = new AbortController();
    taskAbortReference.current = controller;
    try {
      for (let attempt = 0; attempt < 90; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 2_000));
        if (controller.signal.aborted) return;
        const response = await fetch(`/api/tasks/${taskId}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('任务状态暂时无法读取。');
        const body = (await response.json()) as TaskResponse;
        const status = body.data?.status;
        if (status === 'succeeded') {
          setFeedback('OCR 与个人资料提取已完成，在线简历已更新。');
          router.refresh();
          return;
        }
        if (status === 'failed' || status === 'cancelled') {
          setFeedback(null);
          setError(
            status === 'cancelled'
              ? '个人资料提取任务已取消。'
              : (body.data?.errorSummary ?? '个人资料提取失败，请前往任务页查看详情并重试。'),
          );
          return;
        }
      }
      setFeedback('任务仍在后台运行，请稍后刷新页面或前往任务页查看进度。');
    } catch {
      if (controller.signal.aborted) return;
      setFeedback('任务已创建，但自动刷新暂时不可用；请稍后手动刷新页面。');
    }
  };

  const submit = async (event: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const form = formReference.current;
    if (!form) return;
    const file = new FormData(form).get('file');
    if (!(file instanceof File) || file.size === 0) {
      setError('请选择 PDF、DOCX、JPEG 或 PNG 简历。');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('简历文件不能超过 10 MiB。');
      return;
    }
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const response = await fetch('/api/profile/resume', {
        method: 'POST',
        headers: await mutationHeaders(false),
        body: new FormData(form),
      });
      const body = (await response.json()) as ImportResponse;
      if (!response.ok) throw new Error(body.error?.message ?? '简历导入失败。');
      const taskId = body.data?.task?.taskId;
      const usesOcr = body.data?.document?.parseStatus === 'needs_ocr';
      setFeedback(
        taskId
          ? `${usesOcr ? '图片已保存，OCR 与个人资料提取任务已创建' : '简历已保存，个人资料提取任务已创建'}：${taskId}`
          : `简历已保存，但当前状态为 ${body.data?.document?.parseStatus ?? '未知'}。${body.data?.document?.errorSummary ?? ''}`,
      );
      if (taskId) void trackTask(taskId);
      form.reset();
      setFileName(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '简历导入失败。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel-block" data-resume-import aria-labelledby="resume-import-title">
      <div className="section-heading">
        <p className="eyebrow">RESUME INTAKE</p>
        <h2 id="resume-import-title">导入简历</h2>
      </div>
      <p className="muted">
        支持 PDF、DOCX、JPEG、PNG，文件上限 10 MiB。图片会先在本地 Worker 中完成中英文
        OCR，再提取个人资料。
      </p>
      <form
        ref={formReference}
        className={styles.form}
        onSubmit={(event) => void submit(event)}
        noValidate
      >
        {profileId ? <input type="hidden" name="profileId" value={profileId} /> : null}
        <label
          className={styles.dropzone}
          data-resume-dropzone
          onDragOver={(event: DragEvent<HTMLLabelElement>) => {
            event.preventDefault();
            event.currentTarget.dataset.dragging = 'true';
          }}
          onDragLeave={(event: DragEvent<HTMLLabelElement>) => {
            delete event.currentTarget.dataset.dragging;
          }}
          onDrop={(event: DragEvent<HTMLLabelElement>) => {
            event.preventDefault();
            delete event.currentTarget.dataset.dragging;
            const file = event.dataTransfer.files[0];
            if (!file) return;
            const input = event.currentTarget.querySelector('input[type=file]');
            if (input instanceof HTMLInputElement) {
              const transfer = new DataTransfer();
              transfer.items.add(file);
              input.files = transfer.files;
            }
            chooseFile(file);
          }}
        >
          <strong>{fileName ?? '点击选择或拖入简历文件'}</strong>
          <span>PDF / DOCX / JPEG / PNG · 最大 10 MiB</span>
          <input
            name="file"
            type="file"
            accept=".pdf,.docx,.jpg,.jpeg,.png,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png"
            required
            onChange={(event) => {
              chooseFile(event.currentTarget.files?.[0]);
            }}
          />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? '正在上传…' : '导入并生成资料'}
        </button>
      </form>
      <p className={styles.hint}>
        PDF 和 DOCX 会直接解析可读取文字；JPEG 和 PNG 会进入后台 OCR。图片型 PDF 暂不支持
        OCR，请先转换为图片。
      </p>
      {error ? (
        <p className="form-feedback error" role="alert">
          {error}
        </p>
      ) : null}
      {feedback ? (
        <p className="form-feedback success" role="status">
          {feedback}
        </p>
      ) : null}
    </section>
  );
}
