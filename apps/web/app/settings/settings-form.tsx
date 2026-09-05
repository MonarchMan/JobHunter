'use client';

import type { SystemSettings } from '@jobhunter/application/web';
import type { ReactElement, SyntheticEvent } from 'react';
import { useState } from 'react';
import { mutationHeaders } from '../../src/client/csrf.js';
import { SelectField } from '../components/select-field.js';
import { useToast } from '../components/toast-provider.js';
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
  const [syncEnabled, setSyncEnabled] = useState(settings.sourceAutomation.enabled);
  const [syncFrequency, setSyncFrequency] = useState(settings.sourceAutomation.frequency);
  const [syncTime, setSyncTime] = useState(settings.sourceAutomation.time);
  const [scoreEnabled, setScoreEnabled] = useState(settings.matchingAutomation.scoreEnabled);
  const [adviceEnabled, setAdviceEnabled] = useState(settings.matchingAutomation.adviceEnabled);
  const [defaultSort, setDefaultSort] = useState(settings.jobListPreferences.defaultSort);
  const [rememberFilters, setRememberFilters] = useState(
    settings.jobListPreferences.rememberFilters,
  );
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);

  const submit = async (event: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch('/api/settings', {
        method: 'PATCH',
        headers: await mutationHeaders(),
        body: JSON.stringify({
          jobUnderstandingEnabled: enabled,
          sourceSyncChannel,
          sourceAutomationEnabled: syncEnabled,
          sourceAutomationFrequency: syncFrequency,
          sourceAutomationTime: syncTime,
          automaticScoringEnabled: scoreEnabled,
          automaticAdviceEnabled: adviceEnabled,
          defaultJobSort: defaultSort,
          rememberJobFilters: rememberFilters,
        }),
      });
      const body = (await response.json()) as ApiFailure;
      if (!response.ok) throw new Error(body.error?.message ?? '设置保存失败。');
      showToast('设置已保存。');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '设置保存失败。', 'error');
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
      <fieldset className={styles.settingGroup}>
        <legend>自动同步</legend>
        <label className={styles.settingsToggle}>
          <input
            type="checkbox"
            checked={syncEnabled}
            onChange={(event) => {
              setSyncEnabled(event.target.checked);
            }}
          />
          <span>
            <strong>定时同步职位</strong>
            <small>{syncEnabled ? '已开启' : '已关闭'}</small>
          </span>
        </label>
        <div className={styles.compactFields}>
          <label>
            同步频率
            <SelectField
              name="sync-frequency"
              label="同步频率"
              value={syncFrequency}
              disabled={!syncEnabled}
              onValueChange={(value) => {
                setSyncFrequency(value as 'daily' | 'weekly');
              }}
              options={[
                { value: 'daily', label: '每天' },
                { value: 'weekly', label: '每周一' },
              ]}
            />
          </label>
          <label>
            执行时间
            <input
              type="time"
              value={syncTime}
              disabled={!syncEnabled}
              onChange={(event) => {
                setSyncTime(event.target.value);
              }}
            />
          </label>
        </div>
      </fieldset>
      <fieldset className={styles.settingGroup}>
        <legend>自动匹配</legend>
        <label className={styles.settingsToggle}>
          <input
            type="checkbox"
            checked={scoreEnabled}
            onChange={(event) => {
              setScoreEnabled(event.target.checked);
              if (!event.target.checked) setAdviceEnabled(false);
            }}
          />
          <span>
            <strong>同步后自动评分</strong>
            <small>为新职位计算与当前画像的匹配度</small>
          </span>
        </label>
        <label className={styles.settingsToggle}>
          <input
            type="checkbox"
            checked={adviceEnabled}
            disabled={!scoreEnabled}
            onChange={(event) => {
              setAdviceEnabled(event.target.checked);
            }}
          />
          <span>
            <strong>自动生成求职建议</strong>
            <small>需要已经配置 AI 模型</small>
          </span>
        </label>
      </fieldset>
      <fieldset className={styles.settingGroup}>
        <legend>默认职位视图</legend>
        <label className={styles.compactSelect}>
          默认排序
          <SelectField
            name="default-job-sort"
            label="默认职位排序"
            value={defaultSort}
            onValueChange={(value) => {
              setDefaultSort(value as typeof defaultSort);
            }}
            options={[
              { value: 'updated_desc', label: '最近更新' },
              { value: 'published_desc', label: '最近发布' },
              { value: 'score_desc', label: '匹配分数' },
            ]}
          />
        </label>
        <label className={styles.settingsToggle}>
          <input
            type="checkbox"
            checked={rememberFilters}
            onChange={(event) => {
              setRememberFilters(event.target.checked);
            }}
          />
          <span>
            <strong>记住筛选条件</strong>
            <small>下次打开职位页时恢复上次筛选</small>
          </span>
        </label>
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
    </form>
  );
}
