'use client';

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useRouter } from 'next/navigation.js';
import type { WebSource } from '@jobhunter/recruitment/contracts/web';
import { mutationHeaders } from '../../src/client/csrf.js';
import { Icon } from '../components/ui-icon.js';
import { SelectField } from '../components/forms/select-field.js';
import { TimePicker } from '../components/forms/time-picker.js';
import { useToast } from '../components/toast-provider.js';
import { scheduleLabel } from './schedule-label.js';
import { parseSchedule, scheduleExpression, type ScheduleModel } from './schedule-model.js';
import styles from './source-schedule-editor.module.css';

/** 卡片和来源详情共用计划入口；编辑草稿仅在保存时提交。 */
export function SourceScheduleEditor({
  source,
  syncReady,
}: Readonly<{ source: WebSource; syncReady: boolean }>): ReactElement {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={styles.trigger}
        aria-label={`设置 ${source.companyName} 的同步计划`}
        onClick={() => {
          setOpen(true);
        }}
      >
        {source.schedule?.enabled ? scheduleLabel(source.schedule.cronExpression) : '无'}
        <Icon name="edit" size={14} />
      </button>
      {open ? (
        <ScheduleDialog
          source={source}
          syncReady={syncReady}
          onClose={() => {
            setOpen(false);
            trigger.current?.focus();
          }}
        />
      ) : null}
    </>
  );
}

/** 使用北京时间或原计划时区编辑，每周可多选；关闭或失败均不改写已保存计划。 */
function ScheduleDialog({
  source,
  syncReady,
  onClose,
}: Readonly<{ source: WebSource; syncReady: boolean; onClose: () => void }>): ReactElement {
  const reference = useRef<HTMLDialogElement>(null);
  const [model, setModel] = useState(() =>
    parseSchedule(source.schedule?.cronExpression ?? '0 3 * * *'),
  );
  const [enabled, setEnabled] = useState(source.schedule?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();
  const { showToast } = useToast();
  const timezone = source.schedule?.timezone ?? 'Asia/Shanghai';
  useEffect(() => {
    reference.current?.showModal();
  }, []);
  const close = (): void => {
    reference.current?.close();
    onClose();
  };
  const save = async (reset: boolean): Promise<void> => {
    setError('');
    try {
      const body = reset
        ? { kind: 'schedule-reset' }
        : { kind: 'schedule', cronExpression: scheduleExpression(model), timezone, enabled };
      setBusy(true);
      const response = await fetch(`/api/sources/${source.id}`, {
        method: 'PATCH',
        headers: await mutationHeaders(),
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? '同步计划保存失败。');
      showToast(reset ? '已恢复全局同步计划。' : '同步计划已保存。');
      router.refresh();
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '同步计划保存失败。');
    } finally {
      setBusy(false);
    }
  };
  return (
    <dialog
      ref={reference}
      className={styles.dialog}
      aria-labelledby={`schedule-title-${source.id}`}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close();
      }}
    >
      <header className={styles.header}>
        <h2 id={`schedule-title-${source.id}`}>设置同步计划</h2>
        <button
          type="button"
          className="button-close"
          aria-label="关闭同步计划"
          disabled={busy}
          onClick={close}
        >
          <Icon name="close" />
        </button>
      </header>
      <p>仅修改当前来源，全局同步设置改变后会覆盖此处。</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save(false);
        }}
      >
        <fieldset disabled={busy} className={styles.fields}>
          <legend className="sr-only">执行周期</legend>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => {
                setEnabled(event.target.checked);
              }}
            />
            启用定时同步
          </label>
          <div className={styles.modes}>
            {(
              [
                ['daily', '每天'],
                ['weekly', '每周'],
                ['hours', '间隔执行'],
                ...(parseSchedule(source.schedule?.cronExpression ?? '').mode === 'custom' &&
                source.schedule
                  ? [['custom', '保留原计划']]
                  : []),
              ] as const
            ).map(([value, label]) => (
              <label key={value}>
                <input
                  type="radio"
                  name="schedule-mode"
                  value={value}
                  checked={model.mode === value}
                  onChange={() => {
                    setModel({ ...model, mode: value as ScheduleModel['mode'] });
                  }}
                />
                {label}
              </label>
            ))}
          </div>
          {model.mode === 'daily' || model.mode === 'weekly' ? (
            <div className={styles.timeRow}>
              {model.mode === 'weekly' ? (
                <label>
                  <SelectField
                    name="schedule-weekday"
                    label="执行星期"
                    value={String(model.weekdays[0] ?? 1)}
                    onValueChange={(value) => {
                      setModel({ ...model, weekdays: [Number(value)] });
                    }}
                    options={[1, 2, 3, 4, 5, 6, 0].map((day) => ({
                      value: String(day),
                      label: `周${['日', '一', '二', '三', '四', '五', '六'][day] ?? ''}`,
                    }))}
                  />
                </label>
              ) : null}
              <TimePicker
                label="执行时间"
                value={model.time}
                onChange={(time) => {
                  setModel({ ...model, time });
                }}
              />
            </div>
          ) : null}
          {model.mode === 'hours' ? (
            <div className={styles.timeRow}>
              <label className={styles.unitInput}>
                <input
                  type="number"
                  aria-label="间隔小时数"
                  min="1"
                  max="12"
                  step="1"
                  required
                  value={Number.isNaN(model.hours) ? '' : model.hours}
                  onChange={(event) => {
                    setModel({ ...model, hours: event.target.valueAsNumber });
                  }}
                />
                <span>小时</span>
              </label>
              <label className={styles.unitInput}>
                <input
                  type="number"
                  aria-label="分钟"
                  min="0"
                  max="59"
                  step="1"
                  required
                  value={Number.isNaN(model.minute) ? '' : model.minute}
                  onChange={(event) => {
                    setModel({ ...model, minute: event.target.valueAsNumber });
                  }}
                />
                <span>分</span>
              </label>
            </div>
          ) : null}
          {model.mode === 'custom' ? (
            <p>当前是复杂周期，保存时保持不变。选择上方常用周期可替换原计划。</p>
          ) : null}
        </fieldset>
        {!syncReady ? <p>确认求职意向后才能启用定时同步。</p> : null}
        {error ? (
          <p role="alert" className="risk">
            {error}
          </p>
        ) : null}
        <footer className={styles.footer}>
          <button
            type="button"
            className="button-secondary"
            disabled={busy}
            onClick={() => {
              void save(true);
            }}
          >
            恢复全局计划
          </button>
          <button type="submit" disabled={busy || (enabled && !syncReady)}>
            {busy ? '保存中…' : '保存'}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
