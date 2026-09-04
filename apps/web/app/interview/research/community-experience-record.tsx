import type {
  CommunityInterviewExperienceRecord,
  CommunityInterviewQuestionRecord,
} from '@jobhunter/application/web';
import type { ReactElement, ReactNode } from 'react';
import styles from './research.module.css';

function formatSourceDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}

export function CommunityExperienceRecord({
  experience,
  questions,
  occurrenceCounts,
  actions,
}: Readonly<{
  experience: CommunityInterviewExperienceRecord;
  questions: readonly CommunityInterviewQuestionRecord[];
  occurrenceCounts: Readonly<Record<string, number>>;
  actions?: ReactNode;
}>): ReactElement {
  const context = [experience.company, experience.role, experience.stage].filter(Boolean);
  return (
    <article className={styles.experienceRecord}>
      <header className={styles.experienceHeader}>
        <div>
          <p className={styles.recordMeta}>{context.join(' · ') || '岗位信息待核对'}</p>
          <h3>{experience.sourceTitle}</h3>
        </div>
        {actions ? <div className={styles.recordActions}>{actions}</div> : null}
      </header>
      <div className={styles.sourceLine}>
        <a
          href={experience.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${experience.sourceTitle}（在新窗口打开来源）`}
        >
          查看原始来源
        </a>
        <span>{experience.occurredOn ? `面试 ${experience.occurredOn}` : '面试日期未知'}</span>
        <span>
          {experience.sourcePublishedAt
            ? `发布 ${formatSourceDate(experience.sourcePublishedAt)}`
            : '发布日期未知'}
        </span>
        <span>检索 {formatSourceDate(experience.sourceRetrievedAt)}</span>
        <span>外部内容 · 未核验</span>
      </div>
      {experience.tags.length > 0 ? (
        <ul className={styles.tags} aria-label="主题标签">
          {experience.tags.map((tag) => (
            <li key={tag}>{tag}</li>
          ))}
        </ul>
      ) : null}
      <ol className={styles.questionList}>
        {questions.map((question, index) => {
          const occurrences = occurrenceCounts[question.questionFingerprint] ?? 1;
          return (
            <li key={question.id}>
              <div className={styles.questionHeading}>
                <span>Q{String(index + 1).padStart(2, '0')}</span>
                <small>{occurrences > 1 ? `${String(occurrences)} 个来源提及` : '单一来源'}</small>
              </div>
              <strong>{question.question}</strong>
              {question.answerExcerpt ? (
                <p>
                  <b>回答摘录：</b>
                  {question.answerExcerpt}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
    </article>
  );
}
