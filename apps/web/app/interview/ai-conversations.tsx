'use client';

import { useEffect, useState, type ReactElement } from 'react';
import type { AiSessionService } from '@jobhunter/user/ai/service';
import { mutationHeaders } from '../../src/client/csrf.js';

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
  const load = async (id: string): Promise<void> => {
    const response = await fetch(`/api/ai/sessions/${id}`);
    const body = (await response.json()) as { data: Detail; error?: { message: string } };
    if (!response.ok) throw new Error(body.error?.message ?? '读取会话失败。');
    setDetail(body.data);
  };
  useEffect(() => {
    if (!selected) return;
    let active = true;
    const refresh = (): void => {
      if (active)
        void load(selected).catch(() => {
          if (active) setError('读取会话失败。');
        });
    };
    refresh();
    const timer = setInterval(refresh, 2000);
    return () => {
      active = false;
      clearInterval(timer);
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
            setSelected(created.id);
          });
        }}
      >
        <label>
          会话名称
          <input
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
            }}
            required
            maxLength={160}
          />
        </label>
        <label>
          会话类别
          <select
            value={type}
            onChange={(event) => {
              setType(event.target.value as typeof type);
            }}
          >
            <option value="interview">模拟面试</option>
            <option value="chat">日常对话</option>
          </select>
        </label>
        <label>
          关联项目（可选）
          <select
            value={project}
            onChange={(event) => {
              setProject(event.target.value);
            }}
          >
            <option value="">不关联项目</option>
            {projects.map((item) => (
              <option
                key={`${item.profileId}:${item.projectId}`}
                value={`${item.profileId}:${item.projectId}`}
              >
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <button disabled={busy}>新建会话</button>
      </form>
      <label>
        选择会话
        <select
          value={selected}
          onChange={(event) => {
            setDetail(null);
            setSelected(event.target.value);
          }}
        >
          <option value="">请选择</option>
          {items.map((session) => (
            <option key={session.id} value={session.id}>
              {session.title}
            </option>
          ))}
        </select>
      </label>
      {error ? <p role="alert">{error}</p> : null}
      {detail?.session.id === selected ? (
        <>
          <h2>{detail.session.title}</h2>
          <ol aria-label="对话消息" style={{ paddingInlineStart: '1.5rem' }}>
            {detail.messages.map((message) => (
              <li key={message.id}>
                <strong>{message.role === 'user' ? '你' : 'AI'}</strong>
                {editing === message.id ? (
                  <form
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
                        onChange={(event) => {
                          setEdited(event.target.value);
                        }}
                        required
                      />
                    </label>
                    <button disabled={busy}>保存回答</button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(null);
                      }}
                    >
                      取消修改
                    </button>
                  </form>
                ) : (
                  <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
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
                onChange={(event) => {
                  setText(event.target.value);
                }}
                maxLength={20000}
                required
              />
            </label>
            <button
              disabled={busy || detail.messages.some((message) => message.status === 'pending')}
            >
              发送
            </button>
          </form>
        </>
      ) : (
        <p>创建或选择一个会话即可开始。</p>
      )}
    </section>
  );
}
