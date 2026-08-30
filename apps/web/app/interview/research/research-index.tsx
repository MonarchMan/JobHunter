'use client';

import type {
  CommunityExperienceFilter,
  CommunityExperienceSummary,
  ExperienceResearchDetail,
  ExperienceResearchRequestSummary,
} from '@jobhunter/application/web';
import { useRouter } from 'next/navigation.js';
import type { ReactElement, SyntheticEvent } from 'react';
import { useRef, useState } from 'react';
import { mutationHeaders } from '../../../src/client/csrf.js';
import { CommunityExperienceRecord } from './community-experience-record.js';
import styles from './research.module.css';

interface ApiEnvelope<T> {
  readonly data?: T;
  readonly error?: { readonly message?: string };
}

const requestStateLabels = {
  ready: '待执行',
  needs_review: '待审核',
  completed: '已完成',
} as const;

const taskStateLabels = {
  pending: '已排队',
  running: '执行中',
  succeeded: '执行成功',
  failed: '执行失败',
  cancelled: '已取消',
} as const;

function splitList(value: FormDataEntryValue | null): string[] {
  return typeof value === 'string'
    ? value
        .split(/[,，、\n]/)
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function textValue(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

function formatTime(value: string | number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function ResearchIndex({
  requests,
  accepted,
  acceptedFilter,
  acceptedFacets,
  acceptedTotal,
}: Readonly<{
  requests: readonly ExperienceResearchRequestSummary[];
  accepted: readonly CommunityExperienceSummary[];
  acceptedFilter: CommunityExperienceFilter;
  acceptedFacets: Readonly<{
    companies: readonly string[];
    roles: readonly string[];
    stages: readonly string[];
  }>;
  acceptedTotal: number;
}>): ReactElement {
  const router = useRouter();
  const targetRoles = useRef<HTMLInputElement>(null);
  const feedbackRef = useRef<HTMLParagraphElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: SyntheticEvent<HTMLFormElement, SubmitEvent>): Promise<void> => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const roles = splitList(form.get('targetRoles'));
    const dateFrom = textValue(form, 'dateFrom');
    const dateTo = textValue(form, 'dateTo');
    if (roles.length === 0) {
      setError('至少填写一个目标岗位。');
      queueMicrotask(() => targetRoles.current?.focus());
      return;
    }
    if (dateFrom && dateTo && dateFrom > dateTo) {
      setError('结束日期不能早于开始日期。');
      queueMicrotask(() => feedbackRef.current?.focus());
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/interview/research', {
        method: 'POST',
        headers: await mutationHeaders(),
        body: JSON.stringify({
          targetRoles: roles,
          companies: splitList(form.get('companies')),
          locations: splitList(form.get('locations')),
          levels: splitList(form.get('levels')),
          stages: splitList(form.get('stages')),
          dateFrom: dateFrom || null,
          dateTo: dateTo || null,
          language: textValue(form, 'language'),
          maxSources: Number(textValue(form, 'maxSources')),
          maxQuestionsPerSource: Number(textValue(form, 'maxQuestionsPerSource')),
          allowedDomains: splitList(form.get('allowedDomains')),
          blockedDomains: splitList(form.get('blockedDomains')),
        }),
      });
      const result = (await response.json()) as ApiEnvelope<{
        readonly detail: ExperienceResearchDetail;
        readonly deduplicated: boolean;
      }>;
      if (!response.ok || !result.data) {
        throw new Error(result.error?.message ?? '无法创建网友面经研究请求。');
      }
      router.push(`/interview/research/${result.data.detail.request.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '无法创建网友面经研究请求。');
      setBusy(false);
      queueMicrotask(() => feedbackRef.current?.focus());
    }
  };

  return (
    <div className={styles.root}>
      <section className={styles.planner} aria-labelledby="research-plan-title">
        <div className={styles.plannerIntro}>
          <span className={styles.decisionCursor} aria-hidden="true" />
          <div>
            <p className="eyebrow">STEP 01 · DEFINE THE BRIEF</p>
            <h2 id="research-plan-title">先限定问题，再让 Agent 搜集</h2>
            <p>
              研究只访问公开网页，不读取简历、项目目录或本地文件。公司、时间和域名范围越明确，结果越容易核对。
            </p>
          </div>
        </div>
        <form
          className={styles.briefForm}
          noValidate
          aria-busy={busy}
          onSubmit={(event) => void submit(event)}
        >
          <div className={styles.fieldGrid}>
            <label className={styles.fullField} htmlFor="research-target-roles">
              目标岗位 <span aria-hidden="true">*</span>
              <input
                ref={targetRoles}
                id="research-target-roles"
                name="targetRoles"
                required
                maxLength={1_200}
                aria-invalid={error?.includes('目标岗位') ?? false}
                placeholder="后端工程师、Java 工程师"
              />
              <small>用逗号分隔，最多 10 项。</small>
            </label>
            <label>
              目标公司
              <input name="companies" maxLength={2_400} placeholder="字节跳动、美团" />
            </label>
            <label>
              地点
              <input name="locations" maxLength={2_400} placeholder="上海、杭州" />
            </label>
            <label>
              职级
              <input name="levels" maxLength={800} placeholder="校招、3–5 年" />
            </label>
            <label>
              面试阶段
              <input name="stages" maxLength={800} placeholder="技术一面、系统设计" />
            </label>
            <label>
              最早发布日期
              <input name="dateFrom" type="date" />
            </label>
            <label>
              最晚发布日期
              <input name="dateTo" type="date" />
            </label>
            <label>
              结果语言
              <select name="language" defaultValue="zh-CN">
                <option value="zh-CN">简体中文</option>
                <option value="en">English</option>
              </select>
            </label>
            <label>
              最多来源数
              <input name="maxSources" type="number" min={1} max={20} defaultValue={8} />
            </label>
            <label>
              每个来源最多问题数
              <input
                name="maxQuestionsPerSource"
                type="number"
                min={1}
                max={30}
                defaultValue={12}
              />
            </label>
            <label className={styles.fullField}>
              只允许这些域名（可选）
              <input name="allowedDomains" maxLength={7_600} placeholder="nowcoder.com" />
            </label>
            <label className={styles.fullField}>
              排除这些域名（可选）
              <input name="blockedDomains" maxLength={7_600} placeholder="example.com" />
            </label>
          </div>
          {error ? (
            <p ref={feedbackRef} className="form-feedback error" role="alert" tabIndex={-1}>
              {error}
            </p>
          ) : null}
          <div className={styles.formActions}>
            <button type="submit" disabled={busy} aria-busy={busy}>
              {busy ? '正在建立…' : '创建研究 Brief'}
            </button>
            <p>创建后可下载 Prompt 与 Schema，也可以直接发布给本机 Codex。</p>
          </div>
        </form>
      </section>

      <section className={styles.archive} aria-labelledby="research-requests-title">
        <header className={styles.sectionHeading}>
          <div>
            <p className="eyebrow">RESEARCH REQUESTS</p>
            <h2 id="research-requests-title">研究请求</h2>
          </div>
          <span>{requests.length} 项</span>
        </header>
        {requests.length > 0 ? (
          <ol className={styles.requestList}>
            {requests.map(({ request, currentTask }, index) => (
              <li key={request.id}>
                <a href={`/interview/research/${request.id}`}>
                  <span className={styles.archiveIndex}>{String(index + 1).padStart(2, '0')}</span>
                  <span className={styles.requestCopy}>
                    <strong>{request.brief.targetRoles.join(' / ')}</strong>
                    <small>
                      {[...request.brief.companies, ...request.brief.locations].join(' · ') ||
                        '不限公司与地点'}
                    </small>
                  </span>
                  <span className={styles.requestStatus}>
                    {currentTask ? `${taskStateLabels[currentTask.status]} · ` : ''}
                    {requestStateLabels[request.state]} · {formatTime(request.updatedAt)}
                  </span>
                </a>
              </li>
            ))}
          </ol>
        ) : (
          <p className={styles.emptyCopy}>
            尚无研究请求。上方 Brief 会成为第一份可复用的调研约束。
          </p>
        )}
      </section>

      <section className={styles.acceptedArchive} aria-labelledby="accepted-community-title">
        <header className={styles.sectionHeading}>
          <div>
            <p className="eyebrow">ACCEPTED COMMUNITY RECORDS</p>
            <h2 id="accepted-community-title">已接受的网友面经</h2>
          </div>
          <span>
            {accepted.length === acceptedTotal
              ? `${String(accepted.length)} 份`
              : `${String(accepted.length)} / ${String(acceptedTotal)} 份`}
          </span>
        </header>
        {acceptedTotal > 0 ? (
          <form className={styles.archiveFilters} action="/interview/research" method="get">
            <label>
              公司
              <select name="company" defaultValue={acceptedFilter.company ?? ''}>
                <option value="">全部公司</option>
                {acceptedFacets.companies.map((company) => (
                  <option key={company} value={company}>
                    {company}
                  </option>
                ))}
              </select>
            </label>
            <label>
              岗位
              <select name="role" defaultValue={acceptedFilter.role ?? ''}>
                <option value="">全部岗位</option>
                {acceptedFacets.roles.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </label>
            <label>
              阶段
              <select name="stage" defaultValue={acceptedFilter.stage ?? ''}>
                <option value="">全部阶段</option>
                {acceptedFacets.stages.map((stage) => (
                  <option key={stage} value={stage}>
                    {stage}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit">应用筛选</button>
            {Object.keys(acceptedFilter).length > 0 ? (
              <a className="button-secondary" href="/interview/research">
                清除
              </a>
            ) : null}
          </form>
        ) : null}
        {accepted.length > 0 ? (
          <div className={styles.experienceStack}>
            {accepted.map((summary) => (
              <CommunityExperienceRecord
                key={summary.experience.id}
                experience={summary.experience}
                questions={summary.questions}
                occurrenceCounts={summary.occurrenceCounts}
              />
            ))}
          </div>
        ) : (
          <p className={styles.emptyCopy}>
            {acceptedTotal > 0
              ? '没有符合当前公司、岗位和阶段组合的网友面经。'
              : '审核并接受候选后，带来源证据的网友面经会显示在这里。'}
          </p>
        )}
      </section>
    </div>
  );
}
