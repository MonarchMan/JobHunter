'use client';

import type { MailboxSettingsSnapshot, MailboxSettingsView } from '@jobhunter/application/web';
import type { ReactElement, SyntheticEvent } from 'react';
import { useEffect, useState } from 'react';
import { mutationHeaders } from '../../src/client/csrf.js';
import { Icon } from '../components/ui-icon.js';
import { useToast } from '../components/toast-provider.js';
import styles from './settings.module.css';

interface MailboxSettingsProperties {
  readonly initial: MailboxSettingsSnapshot;
  readonly oauthAvailability: {
    readonly gmail: boolean;
    readonly microsoftGraph: boolean;
  };
}

type AddMailboxProvider = 'gmail' | 'microsoft-graph' | 'imap';

interface ApiResponse<T> {
  readonly data?: T;
  readonly error?: { readonly message?: string };
}

/** 设置页的邮箱连接管理；授权码只在用户主动显示期间短暂保留于客户端状态。 */
export function MailboxSettings({
  initial,
  oauthAvailability,
}: MailboxSettingsProperties): ReactElement {
  const [mailboxes, setMailboxes] = useState<readonly MailboxSettingsView[]>(initial.mailboxes);
  const [showProviderPicker, setShowProviderPicker] = useState(false);
  const [addProvider, setAddProvider] = useState<AddMailboxProvider | null>(null);
  const [oauthBusy, setOAuthBusy] = useState<Exclude<AddMailboxProvider, 'imap'> | null>(null);
  const [preset, setPreset] = useState<'qq' | 'custom'>('qq');
  const [address, setAddress] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [host, setHost] = useState('');
  const [port, setPort] = useState('993');
  const [folders, setFolders] = useState('INBOX');
  const [lookback, setLookback] = useState('90');
  const [busy, setBusy] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editFolders, setEditFolders] = useState('INBOX');
  const [editLookback, setEditLookback] = useState('90');
  const [editPassword, setEditPassword] = useState('');
  const [showEditPassword, setShowEditPassword] = useState(false);
  const [savedPassword, setSavedPassword] = useState<string | null>(null);
  const [savedPasswordKey, setSavedPasswordKey] = useState<string | null>(null);
  const [showSavedPassword, setShowSavedPassword] = useState(false);
  const [savedPasswordBusy, setSavedPasswordBusy] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const connected = query.get('mailboxConnected');
    const error = query.get('mailboxError');
    if (connected === 'gmail') showToast('Gmail 已连接，OAuth 凭据已加密保存。');
    if (connected === 'microsoft-graph') showToast('Microsoft 邮箱已连接，OAuth 凭据已加密保存。');
    if (error) showToast(oauthErrorMessage(error), 'error');
    if (connected || error) {
      query.delete('mailboxConnected');
      query.delete('mailboxError');
      const search = query.toString();
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${search ? `?${search}` : ''}`,
      );
    }
  }, [showToast]);

  /** 发起只读 OAuth 授权；令牌交换只在服务端回调中进行。 */
  const startOAuth = async (provider: 'gmail' | 'microsoft-graph'): Promise<void> => {
    setOAuthBusy(provider);
    try {
      const response = await fetch(`/api/mailboxes/oauth/${provider}/start`, {
        method: 'POST',
        headers: await mutationHeaders(),
      });
      const body = (await response.json()) as ApiResponse<{ readonly authorizationUrl: string }>;
      const authorizationUrl = body.data?.authorizationUrl;
      if (!response.ok || !authorizationUrl) {
        throw new Error(body.error?.message ?? 'OAuth 授权启动失败。');
      }
      window.location.assign(authorizationUrl);
    } catch (error) {
      setOAuthBusy(null);
      showToast(error instanceof Error ? error.message : 'OAuth 授权启动失败。', 'error');
    }
  };

  const addMailbox = async (event: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch('/api/mailboxes', {
        method: 'POST',
        headers: await mutationHeaders(),
        body: JSON.stringify({
          preset,
          address,
          password,
          ...(preset === 'custom' ? { host } : {}),
          port: Number(port),
          tls: 'ssl',
          folders: folders
            .split(',')
            .map((value) => value.trim())
            .filter((value) => value.length > 0),
          initialLookbackDays: Number(lookback),
        }),
      });
      const body = (await response.json()) as ApiResponse<MailboxSettingsView>;
      const created = body.data;
      if (!response.ok || !created) throw new Error(body.error?.message ?? '邮箱添加失败。');
      setMailboxes((current) => [...current, created]);
      setPassword('');
      setAddProvider(null);
      showToast('邮箱已保存，授权码已加密保存。');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '邮箱添加失败。', 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggleMailbox = async (mailbox: MailboxSettingsView): Promise<void> => {
    try {
      const response = await fetch(`/api/mailboxes/${encodeURIComponent(mailbox.mailboxKey)}`, {
        method: 'PATCH',
        headers: await mutationHeaders(),
        body: JSON.stringify({ enabled: !mailbox.enabled }),
      });
      const body = (await response.json()) as ApiResponse<MailboxSettingsView>;
      const updated = body.data;
      if (!response.ok || !updated) throw new Error(body.error?.message ?? '邮箱设置保存失败。');
      setMailboxes((current) =>
        current.map((item) => (item.mailboxKey === mailbox.mailboxKey ? updated : item)),
      );
      showToast(updated.enabled ? '邮箱同步已启用。' : '邮箱同步已暂停。');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '邮箱设置保存失败。', 'error');
    }
  };

  const deleteMailboxConnection = async (mailbox: MailboxSettingsView): Promise<void> => {
    if (
      !window.confirm(
        `确定删除 ${mailbox.maskedAddress} 的邮箱连接吗？系统会删除本地配置、撤销本机凭据并清理同步游标；已经生成的申请记录和时间线会保留。`,
      )
    )
      return;
    try {
      const response = await fetch(`/api/mailboxes/${encodeURIComponent(mailbox.mailboxKey)}`, {
        method: 'DELETE',
        headers: await mutationHeaders(),
      });
      const body = (await response.json()) as ApiResponse<{ readonly disconnected: boolean }>;
      if (!response.ok) throw new Error(body.error?.message ?? '邮箱连接删除失败。');
      setMailboxes((current) => current.filter((item) => item.mailboxKey !== mailbox.mailboxKey));
      showToast('邮箱连接已删除，既有申请记录和时间线已保留。');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '邮箱连接删除失败。', 'error');
    }
  };

  const beginEditing = (mailbox: MailboxSettingsView): void => {
    setShowSavedPassword(false);
    setSavedPassword(null);
    setSavedPasswordKey(null);
    setEditingKey(mailbox.mailboxKey);
    setEditFolders(mailbox.folders.join(', '));
    setEditLookback(String(mailbox.initialLookbackDays));
    setEditPassword('');
    setShowEditPassword(false);
  };

  /** 只在用户点击眼睛时读取授权码，并在再次隐藏或切换邮箱时清理明文。 */
  const toggleSavedPassword = async (mailbox: MailboxSettingsView): Promise<void> => {
    if (showSavedPassword && savedPasswordKey === mailbox.mailboxKey) {
      setShowSavedPassword(false);
      setSavedPassword(null);
      setSavedPasswordKey(null);
      return;
    }
    setSavedPasswordBusy(true);
    try {
      const response = await fetch(
        `/api/mailboxes/${encodeURIComponent(mailbox.mailboxKey)}/credential`,
        { method: 'POST', cache: 'no-store', headers: await mutationHeaders(false) },
      );
      const body = (await response.json()) as ApiResponse<{ readonly password: string }>;
      if (!response.ok || !body.data?.password)
        throw new Error(body.error?.message ?? '授权码读取失败。');
      setSavedPassword(body.data.password);
      setSavedPasswordKey(mailbox.mailboxKey);
      setShowSavedPassword(true);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '授权码读取失败。', 'error');
    } finally {
      setSavedPasswordBusy(false);
    }
  };

  const saveMailbox = async (
    event: SyntheticEvent<HTMLFormElement>,
    mailbox: MailboxSettingsView,
  ): Promise<void> => {
    event.preventDefault();
    setEditBusy(true);
    try {
      const response = await fetch(`/api/mailboxes/${encodeURIComponent(mailbox.mailboxKey)}`, {
        method: 'PATCH',
        headers: await mutationHeaders(),
        body: JSON.stringify({
          folders: editFolders
            .split(',')
            .map((value) => value.trim())
            .filter((value) => value.length > 0),
          initialLookbackDays: Number(editLookback),
          ...(mailbox.providerKey === 'imap' && editPassword.length > 0
            ? { newPassword: editPassword }
            : {}),
        }),
      });
      const body = (await response.json()) as ApiResponse<MailboxSettingsView>;
      const updated = body.data;
      if (!response.ok || !updated) throw new Error(body.error?.message ?? '邮箱设置保存失败。');
      setMailboxes((current) =>
        current.map((item) => (item.mailboxKey === mailbox.mailboxKey ? updated : item)),
      );
      setEditPassword('');
      setEditingKey(null);
      showToast(
        mailbox.providerKey === 'imap' && editPassword.length > 0
          ? '邮箱设置和授权码已更新。'
          : '邮箱设置已更新。',
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : '邮箱设置保存失败。', 'error');
    } finally {
      setEditBusy(false);
    }
  };

  return (
    <div className={styles.mailboxSettings}>
      <div className={styles.mailboxHeading}>
        <div className={styles.sectionHeading}>
          <h2 id="mailbox-title">邮箱连接</h2>
          <p className="muted">
            连接 Gmail、Microsoft 365 / Outlook 或 IMAP 邮箱，只读取你授权的邮件范围。
          </p>
        </div>
        <div className={styles.mailboxAddMenu}>
          <button
            type="button"
            className={[styles.mailboxAddButton, 'secondary'].filter(Boolean).join(' ')}
            aria-label="添加邮箱连接"
            aria-expanded={showProviderPicker}
            aria-haspopup="menu"
            title="添加邮箱连接"
            onClick={() => {
              setShowProviderPicker((current) => !current);
              setAddProvider(null);
            }}
          >
            <Icon name="plus" size={20} />
          </button>
          {showProviderPicker ? (
            <div className={styles.mailboxProviderPicker} role="menu" aria-label="选择邮箱类型">
              <button
                type="button"
                className={styles.mailboxProviderOption}
                role="menuitem"
                onClick={() => {
                  setAddProvider('gmail');
                  setShowProviderPicker(false);
                }}
              >
                <img
                  className={styles.mailboxProviderIcon}
                  src="/assets/mail-providers/gmail.svg"
                  alt=""
                  aria-hidden="true"
                />
                <span>
                  <strong>Gmail</strong>
                  <small>Google OAuth · 只读权限</small>
                </span>
              </button>
              <button
                type="button"
                className={styles.mailboxProviderOption}
                role="menuitem"
                onClick={() => {
                  setAddProvider('microsoft-graph');
                  setShowProviderPicker(false);
                }}
              >
                <img
                  className={styles.mailboxProviderIcon}
                  src="/assets/mail-providers/microsoft.svg"
                  alt=""
                  aria-hidden="true"
                />
                <span>
                  <strong>Microsoft 365 / Outlook</strong>
                  <small>Microsoft OAuth · Mail.Read</small>
                </span>
              </button>
              <button
                type="button"
                className={styles.mailboxProviderOption}
                role="menuitem"
                onClick={() => {
                  setAddProvider('imap');
                  setShowProviderPicker(false);
                }}
              >
                <span className={styles.mailboxProviderMark} aria-hidden="true">
                  IMAP
                </span>
                <span>
                  <strong>IMAP 邮箱</strong>
                  <small>QQ、163 和企业邮箱等</small>
                </span>
              </button>
            </div>
          ) : null}
        </div>
      </div>
      <div className={styles.mailboxList}>
        {mailboxes.length === 0 ? (
          <p className="muted">尚未连接邮箱。添加后，Worker 才会按设置读取招聘邮件。</p>
        ) : (
          mailboxes.map((mailbox) => (
            <article className={styles.mailboxCard} key={mailbox.mailboxKey}>
              <div>
                <strong>{mailbox.maskedAddress}</strong>
                <small className="muted">
                  {mailbox.syncStatus === 'not_synced'
                    ? '尚未同步'
                    : mailbox.syncStatus === 'auth_required'
                      ? '需要重新授权'
                      : mailbox.syncStatus === 'failed'
                        ? `最近同步失败：${mailbox.lastErrorCategory ?? '未知错误'}`
                        : '已准备同步'}
                </small>
                <small className="muted">
                  {mailbox.providerKey === 'imap' ? '授权码：已保存' : 'OAuth 凭据：已保存'}
                </small>
                {mailbox.providerKey === 'imap' ? (
                  <span className={styles.savedCredential}>
                    <input
                      aria-label={`已保存授权码 ${mailbox.maskedAddress}`}
                      type={
                        showSavedPassword && savedPasswordKey === mailbox.mailboxKey
                          ? 'text'
                          : 'password'
                      }
                      value={
                        showSavedPassword && savedPasswordKey === mailbox.mailboxKey
                          ? (savedPassword ?? '')
                          : '••••••••'
                      }
                      readOnly
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      className={styles.secretToggle}
                      aria-label={
                        showSavedPassword && savedPasswordKey === mailbox.mailboxKey
                          ? '隐藏已保存授权码'
                          : '显示已保存授权码'
                      }
                      aria-pressed={showSavedPassword && savedPasswordKey === mailbox.mailboxKey}
                      disabled={savedPasswordBusy}
                      onClick={() => {
                        void toggleSavedPassword(mailbox);
                      }}
                    >
                      <Icon
                        name={
                          showSavedPassword && savedPasswordKey === mailbox.mailboxKey
                            ? 'eyeOff'
                            : 'eye'
                        }
                        size={18}
                      />
                    </button>
                  </span>
                ) : null}
              </div>
              <div className="inline-actions">
                <button
                  type="button"
                  className={[styles.mailboxAction, 'secondary'].filter(Boolean).join(' ')}
                  aria-label={`${mailbox.enabled ? '暂停' : '启用'}邮箱同步 ${mailbox.maskedAddress}`}
                  title={mailbox.enabled ? '暂停邮箱同步' : '启用邮箱同步'}
                  onClick={() => {
                    void toggleMailbox(mailbox);
                  }}
                >
                  <Icon name={mailbox.enabled ? 'pause' : 'play'} size={18} />
                </button>
                <button
                  type="button"
                  className={[styles.mailboxAction, 'secondary'].filter(Boolean).join(' ')}
                  aria-label={`编辑邮箱连接 ${mailbox.maskedAddress}`}
                  title="编辑邮箱连接"
                  onClick={() => {
                    beginEditing(mailbox);
                  }}
                >
                  <Icon name="edit" size={18} />
                </button>
                <button
                  type="button"
                  className={[styles.mailboxAction, 'button-danger'].filter(Boolean).join(' ')}
                  aria-label={`删除邮箱连接 ${mailbox.maskedAddress}`}
                  title="删除邮箱连接"
                  onClick={() => {
                    void deleteMailboxConnection(mailbox);
                  }}
                >
                  <Icon name="trash" size={18} />
                </button>
              </div>
              {editingKey === mailbox.mailboxKey ? (
                <form
                  className={styles.mailboxEditForm}
                  onSubmit={(event) => {
                    void saveMailbox(event, mailbox);
                  }}
                >
                  <p className={styles.fieldHelp}>
                    邮箱账号与服务器身份不可原地替换；如需更换账号，请删除连接后重新添加。
                  </p>
                  <label>
                    文件夹（逗号分隔）
                    <input
                      value={editFolders}
                      onChange={(event) => {
                        setEditFolders(event.target.value);
                      }}
                    />
                  </label>
                  <label>
                    初次回溯天数
                    <input
                      type="number"
                      min="1"
                      max="365"
                      value={editLookback}
                      onChange={(event) => {
                        setEditLookback(event.target.value);
                      }}
                    />
                  </label>
                  {mailbox.providerKey === 'imap' ? (
                    <label>
                      新授权码（不修改请留空）
                      <span className={styles.secretInput}>
                        <input
                          type={showEditPassword ? 'text' : 'password'}
                          value={editPassword}
                          autoComplete="new-password"
                          onChange={(event) => {
                            setEditPassword(event.target.value);
                          }}
                        />
                        <button
                          type="button"
                          className={styles.secretToggle}
                          aria-label={showEditPassword ? '隐藏新授权码' : '显示新授权码'}
                          aria-pressed={showEditPassword}
                          onClick={() => {
                            setShowEditPassword((current) => !current);
                          }}
                        >
                          <Icon name={showEditPassword ? 'eyeOff' : 'eye'} size={18} />
                        </button>
                      </span>
                    </label>
                  ) : (
                    <p className={styles.fieldHelp}>
                      OAuth 凭据不可直接编辑；如需更换账号，请删除连接后重新授权。
                    </p>
                  )}
                  <div className="inline-actions">
                    <button type="submit" disabled={editBusy}>
                      {editBusy ? '保存中…' : '保存修改'}
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={editBusy}
                      onClick={() => {
                        setEditingKey(null);
                        setEditPassword('');
                        setShowEditPassword(false);
                      }}
                    >
                      取消
                    </button>
                  </div>
                </form>
              ) : null}
            </article>
          ))
        )}
      </div>
      {addProvider === 'gmail' ? (
        <section className={styles.mailboxForm} aria-labelledby="add-gmail-title">
          <div className={styles.mailboxFormHeader}>
            <h3 id="add-gmail-title">添加 Gmail</h3>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setAddProvider(null);
              }}
            >
              取消
            </button>
          </div>
          <p className={styles.fieldHelp}>
            将打开 Google 授权页，只申请 <code>gmail.readonly</code>，不会发送、修改或删除邮件。
          </p>
          {!oauthAvailability.gmail ? (
            <p className="form-feedback error">
              尚未配置 Gmail OAuth 客户端。请在 .env 中设置 JOBHUNTER_GMAIL_CLIENT_ID。
            </p>
          ) : null}
          <button
            type="button"
            disabled={!oauthAvailability.gmail || oauthBusy !== null}
            onClick={() => {
              void startOAuth('gmail');
            }}
          >
            {oauthBusy === 'gmail' ? '正在打开 Google 授权…' : '使用 Google 账号连接'}
          </button>
        </section>
      ) : null}
      {addProvider === 'microsoft-graph' ? (
        <section className={styles.mailboxForm} aria-labelledby="add-microsoft-title">
          <div className={styles.mailboxFormHeader}>
            <h3 id="add-microsoft-title">添加 Microsoft 365 / Outlook 邮箱</h3>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setAddProvider(null);
              }}
            >
              取消
            </button>
          </div>
          <p className={styles.fieldHelp}>
            将打开 Microsoft 授权页，只申请 <code>Mail.Read</code>，不会发送、修改或删除邮件。
          </p>
          {!oauthAvailability.microsoftGraph ? (
            <p className="form-feedback error">
              尚未配置 Microsoft OAuth 客户端。请在 .env 中设置 JOBHUNTER_MICROSOFT_CLIENT_ID。
            </p>
          ) : null}
          <button
            type="button"
            disabled={!oauthAvailability.microsoftGraph || oauthBusy !== null}
            onClick={() => {
              void startOAuth('microsoft-graph');
            }}
          >
            {oauthBusy === 'microsoft-graph'
              ? '正在打开 Microsoft 授权…'
              : '使用 Microsoft 账号连接'}
          </button>
        </section>
      ) : null}
      {addProvider === 'imap' ? (
        <form
          className={styles.mailboxForm}
          onSubmit={(event) => {
            void addMailbox(event);
          }}
          noValidate
        >
          <div className={styles.mailboxFormHeader}>
            <h3>添加 IMAP 邮箱</h3>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => {
                setAddProvider(null);
                setPassword('');
              }}
            >
              取消
            </button>
          </div>
          <p className={styles.fieldHelp}>
            QQ 邮箱请先在邮箱网页版开启 IMAP，并填写 16 位授权码，不要填写 QQ
            登录密码。授权码不会写入配置文件。
          </p>
          <label>
            邮箱类型
            <select
              value={preset}
              onChange={(event) => {
                setPreset(event.target.value as 'qq' | 'custom');
              }}
            >
              <option value="qq">QQ 邮箱</option>
              <option value="custom">其他 IMAP 邮箱</option>
            </select>
          </label>
          <label>
            完整邮箱地址
            <input
              type="email"
              value={address}
              onChange={(event) => {
                setAddress(event.target.value);
              }}
              required
            />
          </label>
          <label>
            {preset === 'qq' ? 'QQ 邮箱授权码' : '应用专用密码'}
            <span className={styles.secretInput}>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                autoComplete="new-password"
                onChange={(event) => {
                  setPassword(event.target.value);
                }}
                required
              />
              <button
                type="button"
                className={styles.secretToggle}
                aria-label={showPassword ? '隐藏授权码' : '显示授权码'}
                aria-pressed={showPassword}
                onClick={() => {
                  setShowPassword((current) => !current);
                }}
              >
                <Icon name={showPassword ? 'eyeOff' : 'eye'} size={18} />
              </button>
            </span>
          </label>
          {preset === 'custom' ? (
            <label>
              IMAP 主机
              <input
                value={host}
                onChange={(event) => {
                  setHost(event.target.value);
                }}
                required
              />
            </label>
          ) : null}
          <div className={styles.compactFields}>
            <label>
              端口
              <input
                type="number"
                min="1"
                max="65535"
                value={port}
                onChange={(event) => {
                  setPort(event.target.value);
                }}
              />
            </label>
            <label>
              初次回溯天数
              <input
                type="number"
                min="1"
                max="365"
                value={lookback}
                onChange={(event) => {
                  setLookback(event.target.value);
                }}
              />
            </label>
          </div>
          <label>
            文件夹（逗号分隔）
            <input
              value={folders}
              onChange={(event) => {
                setFolders(event.target.value);
              }}
            />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? '保存中…' : '保存邮箱'}
          </button>
        </form>
      ) : null}
      <p className={styles.fieldHelp}>
        配置文件位置：{initial.configurationPath ?? '使用默认数据目录'}
      </p>
    </div>
  );
}

/** 将 OAuth 回调固定状态码转换为用户可操作的中文提示。 */
function oauthErrorMessage(code: string): string {
  if (code === 'authorization_cancelled') return '邮箱授权已取消。';
  if (code === 'not_configured') return 'OAuth 客户端尚未配置。';
  if (code === 'invalid_state' || code === 'invalid_callback')
    return '邮箱授权状态已失效，请重新发起连接。';
  return '邮箱授权失败，请检查 OAuth 配置后重试。';
}
