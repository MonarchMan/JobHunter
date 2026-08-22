import type { ReactElement } from 'react';
import { JobStatus } from '../components/job-status.js';
import { getWebContainer } from '../../src/server/container.js';
import {
  firstPageHref,
  firstSearchParameter,
  nextPageHref,
  parseWebJobQuery,
  type SearchParameterSource,
} from '../../src/server/job-query.js';

export const dynamic = 'force-dynamic';

interface JobsPageProperties {
  readonly searchParams: Promise<SearchParameterSource>;
}

function fieldValue(source: SearchParameterSource, name: string): string {
  return firstSearchParameter(source, name) ?? '';
}

export default async function JobsPage({
  searchParams,
}: JobsPageProperties): Promise<ReactElement> {
  const parameters = await searchParams;
  const query = parseWebJobQuery(parameters);
  const container = await getWebContainer();
  const page = container.services.webJobs.list(query);
  return (
    <main id="main-content" tabIndex={-1}>
      <div className="page-heading">
        <div>
          <p className="eyebrow">OPPORTUNITIES</p>
          <h1>职位列表</h1>
        </div>
        <p>默认隐藏已关闭职位。筛选条件会保存在当前 URL 中。</p>
      </div>
      <form className="filters" action="/jobs" method="get" aria-label="职位筛选">
        <label>
          关键词
          <input
            name="q"
            defaultValue={fieldValue(parameters, 'q')}
            placeholder="Agent、大模型应用…"
          />
        </label>
        <label>
          公司
          <input
            name="company"
            defaultValue={fieldValue(parameters, 'company')}
            placeholder="腾讯,字节"
          />
        </label>
        <label>
          地点
          <input
            name="location"
            defaultValue={fieldValue(parameters, 'location')}
            placeholder="北京,深圳"
          />
        </label>
        <label>
          职位族
          <input name="family" defaultValue={fieldValue(parameters, 'family')} placeholder="研发" />
        </label>
        <label>
          状态
          <select name="status" defaultValue={fieldValue(parameters, 'status')}>
            <option value="">在招和待确认</option>
            <option value="active">仅在招</option>
            <option value="stale">仅待确认</option>
            <option value="closed">仅已关闭</option>
            <option value="active,stale,closed">全部状态</option>
          </select>
        </label>
        <label>
          排序
          <select name="sort" defaultValue={fieldValue(parameters, 'sort') || 'updated_desc'}>
            <option value="updated_desc">最近更新</option>
            <option value="published_desc">最近发布</option>
            <option value="score_desc">匹配分数</option>
          </select>
        </label>
        <label>
          最低分
          <input
            name="minScore"
            type="number"
            min="0"
            max="100"
            defaultValue={fieldValue(parameters, 'minScore')}
          />
        </label>
        <label>
          画像版本 ID
          <input name="profile" defaultValue={fieldValue(parameters, 'profile')} />
        </label>
        <button type="submit">应用筛选</button>
        <a className="button-secondary" href="/jobs">
          清除
        </a>
      </form>
      <p className="result-summary" aria-live="polite">
        本页 {page.items.length} 个职位
      </p>
      {page.items.length === 0 ? (
        <section className="empty-state page-empty-state" aria-labelledby="jobs-empty-title">
          <span className="empty-state-icon" aria-hidden="true">
            ⌕
          </span>
          <h2 id="jobs-empty-title">没有符合条件的职位</h2>
          <p>尝试减少筛选条件，或先同步官网来源。</p>
          <div className="inline-actions">
            <a className="button-secondary" href="/jobs">
              清除筛选
            </a>
            <a className="button-primary" href="/sources">
              管理招聘来源
            </a>
          </div>
        </section>
      ) : (
        <div className="table-scroll">
          <table>
            <caption className="sr-only">可投递职位列表</caption>
            <thead>
              <tr>
                <th scope="col">职位</th>
                <th scope="col">公司</th>
                <th scope="col">地点</th>
                <th scope="col">状态</th>
                <th scope="col">匹配分</th>
                <th scope="col">更新时间</th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((job) => (
                <tr key={job.id} className={job.status === 'stale' ? 'row-stale' : undefined}>
                  <td>
                    <a className="job-link" href={`/jobs/${job.id}`}>
                      {job.title}
                    </a>
                    <span>{job.department ?? job.jobFamily ?? '部门未注明'}</span>
                  </td>
                  <td>{job.companyName}</td>
                  <td>{job.locations.join('、') || '未注明'}</td>
                  <td>
                    <JobStatus status={job.status} />
                  </td>
                  <td>{job.score === null ? '尚未匹配' : `${job.score.toFixed(1)} 分`}</td>
                  <td>
                    <time dateTime={job.updatedAt}>
                      {new Intl.DateTimeFormat('zh-CN').format(new Date(job.updatedAt))}
                    </time>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <nav className="pagination" aria-label="职位分页">
        {fieldValue(parameters, 'cursor') ? (
          <a href={firstPageHref(parameters)}>返回第一页</a>
        ) : (
          <span />
        )}
        {page.nextCursor ? (
          <a href={nextPageHref(parameters, page.nextCursor)}>下一页</a>
        ) : (
          <span>已经到底</span>
        )}
      </nav>
    </main>
  );
}
