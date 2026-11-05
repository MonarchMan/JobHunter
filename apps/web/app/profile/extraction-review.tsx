'use client';

import { useState, type ReactElement } from 'react';
import type { WebProfileDetail } from '@jobhunter/user/contracts/web';
import { mutationHeaders } from '../../src/client/csrf.js';

const fieldLabels: Readonly<Record<string, string>> = {
  matchingConstraints: '匹配条件',
  basicInfo: '基本信息',
  targetRoles: '岗位方向',
  intendedRoles: '意向岗位',
  preferences: '求职偏好',
  education: '教育经历',
  workExperience: '工作经历',
  projects: '项目经历',
  works: '作品',
  competitions: '竞赛',
  certificates: '证书',
  languages: '语言',
  professionalSkills: '专业技能',
  selfEvaluation: '自我评价',
  skills: '匹配技能',
  domains: '行业领域',
  yearsOfExperience: '工作年限',
  managementExperience: '管理经验',
};

/** 展示候选与当前值的差异，只有用户选中的字段可以成为新生效版本。 */
export function ExtractionReview({
  detail,
}: {
  readonly detail: WebProfileDetail;
}): ReactElement | null {
  const candidate = detail.versions.find(
    (version) => version.isCandidate && version.baseVersionId === detail.current.id,
  );
  const [fields, setFields] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!candidate) return null;
  const differences = Object.entries(candidate.effective).filter(
    ([key, value]) =>
      JSON.stringify(value) !==
      JSON.stringify(detail.current.effective[key as keyof typeof candidate.effective]),
  );
  return (
    <section className="panel-block" aria-label="提取结果确认">
      <h2>提取结果待确认</h2>
      <p>当前画像尚未更改。选择需要应用的字段；未选择的内容保持当前值。</p>
      {differences.map(([key, value]) => (
        <details key={key}>
          <summary>{fieldLabels[key] ?? key}</summary>
          <label>
            <input
              type="checkbox"
              checked={fields.includes(key)}
              onChange={(event) => {
                setFields((previous) =>
                  event.target.checked
                    ? [...previous, key]
                    : previous.filter((field) => field !== key),
                );
              }}
            />
            应用{fieldLabels[key] ?? key}
          </label>
          <p>当前值</p>
          <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {JSON.stringify(
              detail.current.effective[key as keyof typeof candidate.effective],
              null,
              2,
            )}
          </pre>
          <p>提取值</p>
          <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {JSON.stringify(value, null, 2)}
          </pre>
        </details>
      ))}
      {error ? <p role="alert">{error}</p> : null}
      <button
        disabled={busy || fields.length === 0}
        onClick={() => {
          setBusy(true);
          setError('');
          void (async () => {
            try {
              const response = await fetch('/api/profile', {
                method: 'PATCH',
                headers: await mutationHeaders(),
                body: JSON.stringify({
                  kind: 'confirm-extraction',
                  profileId: detail.profile.id,
                  expectedVersionId: detail.current.id,
                  candidateVersionId: candidate.id,
                  fields,
                }),
              });
              if (!response.ok)
                throw new Error(
                  response.status === 409 ? '画像已变化，请重新提取后确认。' : '应用失败，请重试。',
                );
              window.location.reload();
            } catch (failure) {
              setError(failure instanceof Error ? failure.message : '应用失败。');
              setBusy(false);
            }
          })();
        }}
      >
        应用所选字段
      </button>
    </section>
  );
}
