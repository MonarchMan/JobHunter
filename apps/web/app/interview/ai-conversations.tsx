'use client';

import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { AiSessionService } from '@jobhunter/user/ai/service';
import { mutationHeaders } from '../../src/client/csrf.js';
import { SelectField } from '../components/forms/select-field.js';
import styles from './ai-conversations.module.css';

type Detail = ReturnType<AiSessionService['detail']>;
/** 通用会话界面；回复任务独立执行，刷新只查询消息，不重复发布。 */
export function AiConversations({
  sessions,
  projects,
}: {
  readonly sessions: ReturnType<AiSessionService['list']>;
  readonly projects: ReturnType<AiSessionService['projects']>;
}): ReactElement {
  const [items, setItems] = useState(sessions);
  const [selected, setSelected] = useState(sessions[0]?.id ?? '');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [title, setTitle] = useState('模拟面试');
  const [type, setType] = useState<'interview' | 'chat'>('interview');
  const [project, setProject] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [edited, setEdited] = useState('');
  const selection = useRef(selected);
  const latestLoad = useRef(0);
  /** 响应只写入当前会话，旧请求和已取消的轮询不能覆盖新消息。 */
  const load = async (id: string, signal?: AbortSignal): Promise<void> => {
    const request = ++latestLoad.current;
    const response = await fetch(`/api/ai/sessions/${id}`, { signal: signal ?? null });
    const body = (await response.json()) as { data: Detail; error?: { message: string } };
    if (!response.ok) throw new Error(body.error?.message ?? '读取会话失败。');
    if (request === latestLoad.current && selection.current === id && !signal?.aborted)
      setDetail(body.data);
  };
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // 每轮读取结束后再安排下次读取，避免慢请求堆积和响应顺序倒置。
    const refresh = async (): Promise<void> => {
      try {
        await load(selected, controller.signal);
      } catch {
        if (!controller.signal.aborted) setError('读取会话失败。');
      }
      if (!controller.signal.aborted)
        timer = setTimeout(() => {
          void refresh();
        }, 2000);
    };
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [selected]);
  const mutate = async (url: string, method: string, value: unknown): Promise<unknown> => {
    const response = await fetch(url, {
      method,
      headers: await mutationHeaders(),
      body: JSON.stringify(value),
    });
    const body = (await response.json()) as { data: unknown; error?: { message: string } };
    if (!response.ok) throw new Error(body.error?.message ?? '操作失败。');
    return body.data;
  };
  const action = (operation: () => Promise<void>): void => {
    setBusy(true);
    setError('');
    void operation()
      .catch((failure: unknown) => {
        setError(failure instanceof Error ? failure.message : '操作失败。');
      })
      .finally(() => {
        setBusy(false);
      });
  };
  return (
    <section className="panel-block" aria-label="AI 会话">
      <form
        className={styles.createForm}
        onSubmit={(event) => {
          event.preventDefault();
          action(async () => {
            const linkedProject = projects.find(
              (item) => `${item.profileId}:${item.projectId}` === project,
            );
            const created = (await mutate('/api/ai/sessions', 'POST', {
              title,
              type,
              ...(linkedProject
                ? { profileId: linkedProject.profileId, projectId: linkedProject.projectId }
                : {}),
            })) as Detail['session'];
            setItems((previous) => [created, ...previous]);
            selection.current = created.id;
            setDetail(null);
            setEditing(null);
            setText('');
            setSelected(created.id);
          });
        }}
      >
        <label>
          会话名称
          <input
            value={title}
            disabled={busy}
            onChange={(event) => {
              setTitle(event.target.value);
            }}
            required
            maxLength={160}
          />
        </label>
        <div className={styles.field}>
          <span>会话类别</span>
          <SelectField
            name="sessionType"
            label="会话类别"
            value={type}
            disabled={busy}
            onValueChange={(value) => {
              setType(value as typeof type);
            }}
            options={[
              { value: 'interview', label: '模拟面试' },
              { value: 'chat', label: '日常对话' },
            ]}
          />
        </div>
        <div className={styles.field}>
          <span>关联项目（可选）</span>
          <SelectField
            name="project"
            label="关联项目（可选）"
            value={project}
            disabled={busy}
            onValueChange={setProject}
            options={[
              { value: '', label: '不关联项目' },
              ...projects.map((item) => ({
                value: `${item.profileId}:${item.projectId}`,
                label: item.name,
              })),
            ]}
          />
        </div>
        <button className="button-primary" disabled={busy || !title.trim()}>
          新建会话
        </button>
      </form>
      <div className={styles.sessionPicker}>
        <span>选择会话</span>
        <SelectField
          name="session"
          label="选择会话"
          value={selected}
          disabled={busy || items.length === 0}
          onValueChange={(id) => {
            selection.current = id;
            setDetail(null);
            setEditing(null);
            setEdited('');
            setText('');
            setError('');
            setSelected(id);
          }}
          options={[
            { value: '', label: items.length ? '请选择' : '暂无会话' },
            ...items.map((session) => ({ value: session.id, label: session.title })),
          ]}
        />
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {detail?.session.id === selected ? (
        <>
          <h2>{detail.session.title}</h2>
          <ol aria-label="对话消息" className={styles.messages}>
            {detail.messages.map((message) => (
              <li
                key={message.id}
                className={message.role === 'user' ? styles.userMessage : styles.assistantMessage}
              >
                <strong>{message.role === 'user' ? '你' : 'AI'}</strong>
                {editing === message.id ? (
                  <form
                    className={styles.messageForm}
                    onSubmit={(event) => {
                      event.preventDefault();
                      action(async () => {
                        await mutate(`/api/ai/sessions/${selected}`, 'PATCH', {
                          messageId: message.id,
                          content: edited,
                          expectedUpdatedAt: message.updatedAt,
                        });
                        setEditing(null);
                        await load(selected);
                      });
                    }}
                  >
                    <label>
                      修改回答
                      <textarea
                        value={edited}
                        disabled={busy}
                        onChange={(event) => {
                          setEdited(event.target.value);
                        }}
                        required
                        maxLength={20000}
                        rows={4}
                      />
                    </label>
                    <div className={styles.actions}>
                      <button className="button-primary" disabled={busy || !edited.trim()}>
                        保存回答
                      </button>
                      <button
                        type="button"
                        className="button-secondary"
                        disabled={busy}
                        onClick={() => {
                          setEditing(null);
                        }}
                      >
                        取消修改
                      </button>
                    </div>
                  </form>
                ) : (
                  <p className={styles.messageText}>
                    {message.content ||
                      {
                        pending: '正在生成…',
                        failed: '生成失败，请在任务页查看原因并重试。',
                        cancelled: '输入已变化，本次回复已取消。',
                        completed: '',
                      }[message.status]}
                  </p>
                )}
                {message.role === 'user' && editing !== message.id ? (
                  <button
                    type="button"
                    className="button-secondary"
                    disabled={busy}
                    onClick={() => {
                      setEditing(message.id);
                      setEdited(message.content);
                    }}
                  >
                    修改回答
                  </button>
                ) : null}
              </li>
            ))}
          </ol>
          <form
            className={styles.messageForm}
            onSubmit={(event) => {
              event.preventDefault();
              action(async () => {
                await mutate(`/api/ai/sessions/${selected}`, 'POST', { content: text });
                setText('');
                await load(selected);
              });
            }}
          >
            <label>
              消息
              <textarea
                value={text}
                disabled={busy}
                onChange={(event) => {
                  setText(event.target.value);
                }}
                maxLength={20000}
                required
                rows={4}
              />
            </label>
            <button
              className="button-primary"
              disabled={
                busy ||
                !text.trim() ||
                detail.messages.some((message) => message.status === 'pending')
              }
            >
              发送
            </button>
          </form>
        </>
      ) : !error ? (
        <p className="muted">{selected ? '正在读取会话…' : '创建或选择一个会话即可开始。'}</p>
      ) : null}
    </section>
  );
}
