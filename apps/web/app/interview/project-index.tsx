'use client';

import type { AvailableResumeProject, ProjectDossierSummary } from '@jobhunter/application/web';
import { useRouter } from 'next/navigation.js';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { mutationHeaders } from '../../src/client/csrf.js';
import styles from './project-index.module.css';

interface ApiEnvelope<T> {
  readonly data?: T;
  readonly error?: { readonly message?: string };
}

export function InterviewProjectIndex({
  availableProjects,
  dossiers,
}: Readonly<{
  availableProjects: readonly AvailableResumeProject[];
  dossiers: readonly ProjectDossierSummary[];
}>): ReactElement {
  const router = useRouter();
  const [busyProject, setBusyProject] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const create = async (project: AvailableResumeProject): Promise<void> => {
    const key = `${project.profileVersionId}:${String(project.projectIndex)}`;
    setBusyProject(key);
    setFeedback(null);
    try {
      const response = await fetch('/api/interview/projects', {
        method: 'POST',
        headers: await mutationHeaders(),
        body: JSON.stringify({
          profileVersionId: project.profileVersionId,
          projectIndex: project.projectIndex,
          expectedProjectHash: project.projectHash,
        }),
      });
      const body = (await response.json()) as ApiEnvelope<{
        readonly dossier: ProjectDossierSummary;
      }>;
      if (!response.ok || !body.data) {
        throw new Error(body.error?.message ?? '无法创建项目准备档案。');
      }
      router.push(`/interview/projects/${body.data.dossier.dossier.id}`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : '无法创建项目准备档案。');
      setBusyProject(null);
    }
  };

  return (
    <div className={styles.root} data-interview-workbench>
      <section
        className={styles.source}
        aria-labelledby="resume-projects-title"
        data-project-source
      >
        <div className={styles.sectionHeading}>
          <div>
            <h2 id="resume-projects-title">选择简历项目</h2>
            <p>每个项目建立一份独立档案，沿着面试问题逐步补齐理解。</p>
          </div>
          <span>{availableProjects.length} 个可选项目</span>
        </div>
        {availableProjects.length === 0 ? (
          <div className="empty-state">
            <h3>简历里还没有可用项目</h3>
            <p>先导入或编辑个人资料中的项目经历，再回来开始拷打。</p>
            <a className="button-primary" href="/profile#resume-projects">
              补充项目经历
            </a>
          </div>
        ) : (
          <div className={styles.projectList}>
            {availableProjects.map((project) => {
              const key = `${project.profileVersionId}:${String(project.projectIndex)}`;
              const existing = dossiers.find(
                (item) =>
                  item.snapshot.sourceProfileVersionId === project.profileVersionId &&
                  item.snapshot.projectIndex === project.projectIndex &&
                  item.snapshot.contentHash === project.projectHash,
              );
              return (
                <article className={styles.project} key={key}>
                  <div className={styles.projectCopy}>
                    <div className={styles.projectMeta}>
                      <span>{project.profileName}</span>
                      <span>{existing ? '已有准备档案' : '尚未开始'}</span>
                    </div>
                    <div className={styles.projectTitle}>
                      <h3>{project.name}</h3>
                      <p>{project.role ?? '简历未填写项目角色'}</p>
                    </div>
                    {project.highlights[0] ? (
                      <blockquote>{project.highlights[0]}</blockquote>
                    ) : null}
                  </div>
                  <div className={styles.projectAction}>
                    {existing ? (
                      <a
                        className="button-secondary"
                        href={`/interview/projects/${existing.dossier.id}`}
                      >
                        继续准备
                      </a>
                    ) : (
                      <button
                        className="button-secondary"
                        type="button"
                        disabled={busyProject !== null}
                        onClick={() => void create(project)}
                      >
                        {busyProject === key ? '正在创建…' : '建立准备档案'}
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
        {feedback ? (
          <p className="form-feedback error" role="alert">
            {feedback}
          </p>
        ) : null}
      </section>

      <section className={styles.archive} aria-labelledby="dossiers-title" data-dossier-archive>
        <div className={styles.sectionHeading}>
          <div>
            <h2 id="dossiers-title">准备档案</h2>
            <p>从已保存的进度继续，不必重新梳理项目背景。</p>
          </div>
          <span>{dossiers.length} 份</span>
        </div>
        {dossiers.length === 0 ? (
          <p className={styles.emptyArchive}>
            选择上方项目后，这里会保存问题、回答修订与覆盖记录。
          </p>
        ) : (
          <ul className={styles.dossierList}>
            {dossiers.map((item) => (
              <li key={item.dossier.id}>
                <a
                  className={item.activeSessionId ? styles.activeDossier : undefined}
                  data-active-session={item.activeSessionId ? 'true' : undefined}
                  href={`/interview/projects/${item.dossier.id}`}
                >
                  <span className={styles.cursor} aria-hidden="true" />
                  <span className={styles.dossierCopy}>
                    <span className={styles.dossierStatus}>
                      {item.activeSessionId ? '进行中' : '待开始'}
                    </span>
                    <strong>{item.snapshot.project.name}</strong>
                    <small>
                      {item.sourceAvailable ? '来源简历可用' : '来源已分离'} · {item.sessions}{' '}
                      轮会话
                    </small>
                  </span>
                  <span className={styles.dossierAction}>
                    {item.activeSessionId ? '继续' : '查看'}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
