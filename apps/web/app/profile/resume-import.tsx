'use client';

import type { DragEvent, ReactElement, SyntheticEvent } from 'react';
import { useRef, useState } from 'react';
import { mutationHeaders } from '../../src/client/csrf.js';

interface ImportResponse {
  readonly data?: {
    readonly document?: { readonly parseStatus?: string; readonly errorSummary?: string | null };
    readonly task?: { readonly taskId?: string } | null;
  };
  readonly error?: { readonly message?: string };
}

export function ResumeImport({ profileId }: Readonly<{ profileId?: string }>): ReactElement {
  const formReference = useRef<HTMLFormElement>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);

  const chooseFile = (file: File | undefined): void => {
    setFileName(file && file.size > 0 ? file.name : null);
    if (file) setError(null);
  };

  const submit = async (event: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const form = formReference.current;
    if (!form) return;
    const file = new FormData(form).get('file');
    if (!(file instanceof File) || file.size === 0) {
      setError('请选择 PDF 或 DOCX 简历。');
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
      setFeedback(
        taskId
          ? `简历已保存，个人资料提取任务已创建：${taskId}`
          : `简历已保存，但当前状态为 ${body.data?.document?.parseStatus ?? '未知'}。${body.data?.document?.errorSummary ?? ''}`,
      );
      form.reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '简历导入失败。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel-block resume-import" aria-labelledby="resume-import-title">
      <div className="section-heading">
        <p className="eyebrow">RESUME INTAKE</p>
        <h2 id="resume-import-title">导入简历</h2>
      </div>
      <p className="muted">支持 PDF、DOCX，文件上限 10 MiB。导入后由后台任务提取个人资料。</p>
      <form
        ref={formReference}
        className="resume-upload-form"
        onSubmit={(event) => void submit(event)}
        noValidate
      >
        {profileId ? <input type="hidden" name="profileId" value={profileId} /> : null}
        <label
          className="resume-dropzone"
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
          <span>PDF / DOCX · 最大 10 MiB</span>
          <input
            name="file"
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            required
            onChange={(event) => {
              chooseFile(event.currentTarget.files?.[0]);
            }}
          />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? '正在上传…' : '导入并生成资料'}
        </button>
        <button type="button" className="button-muted planned-action" disabled aria-describedby="ocr-planned-note">
          扫描件 OCR 识别
          <span>规划中</span>
        </button>
      </form>
      <p id="ocr-planned-note" className="action-hint">当前会自动解析可读取文字的 PDF 和 DOCX；图片型 PDF 的 OCR 识别将在后续版本开放。</p>
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
