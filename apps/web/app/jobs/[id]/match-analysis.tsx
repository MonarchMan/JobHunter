import { objectiveRuleRows, ruleGaps } from './match-summary.js';
import type { ReactElement } from 'react';
import type { WebJobDetail } from '@jobhunter/matching/contracts/web';
import styles from './page.module.css';

type Match = WebJobDetail['matches'][number];
const names: Readonly<Record<string, string>> = {
  skills: '技能',
  experience: '经验',
  projects: '项目 / 实践',
  role: '岗位方向',
  industry: '行业',
  location: '地点',
};

/** 规则与模型各用一张卡片，分项仅展示为行，缺口集中去重。 */
export function MatchAnalysis({ match }: { readonly match: Match }): ReactElement {
  const rules = match.components.filter((item) => item.dimension !== 'model');
  const model = match.components.find((item) => item.dimension === 'model');
  const gaps = ruleGaps(rules);
  const objective = rules.some((item) => item.dimension === 'qualification');
  const separateDimensions = rules.some(
    (item) => item.dimension === 'role' || item.dimension === 'location',
  );
  const conditionRows = objective ? objectiveRuleRows(match.ruleOutcomes, separateDimensions) : [];
  return (
    <div className={styles.scoreGrid}>
      <section className={styles.scoreCard} aria-label="规则评分">
        <div className={styles.scoreHeading}>
          <h3>规则评分</h3>
          <strong className={styles.scoreValue}>
            {rules.reduce((sum, item) => sum + item.score, 0).toFixed(1)} <small>/ 100</small>
          </strong>
        </div>
        <dl className={styles.scoreRows}>
          {conditionRows.map((item) => (
            <div key={item.key}>
              <dt>{item.label}</dt>
              <dd>
                {item.score.toFixed(1)} / {item.maximumScore.toFixed(1)}
              </dd>
            </div>
          ))}
          {rules
            .filter((item) => item.dimension !== 'qualification')
            .map((item) => (
              <div key={item.dimension}>
                <dt>{names[item.dimension] ?? item.dimension}</dt>
                <dd>
                  {item.evidenceStatus === 'not_applicable'
                    ? '不适用'
                    : item.evidenceStatus === 'unknown' && !objective
                      ? `待确认 / ${item.maximumScore.toFixed(1)}`
                      : `${item.score.toFixed(1)} / ${item.maximumScore.toFixed(1)}`}
                </dd>
              </div>
            ))}
        </dl>
        {gaps.length > 0 && (
          <div className={styles.gaps}>
            <h4>{objective ? '不符合的条件' : '缺口'}</h4>
            {!objective && <p className="muted">材料中尚未体现的证据</p>}
            <p>{gaps.join('、')}</p>
          </div>
        )}
      </section>
      <section className={styles.scoreCard} aria-label="模型评分">
        <div className={styles.scoreHeading}>
          <h3>模型评分</h3>
          {model?.modelScore !== undefined && (
            <strong className={styles.scoreValue}>
              {model.modelScore.toFixed(1)} <small>/ 100</small>
            </strong>
          )}
        </div>
        {model?.modelScore !== undefined ? (
          <>
            <ul className={styles.evidenceList}>
              {model.matchedEvidence.map((item, index) => (
                <li key={index}>{item.summary}</li>
              ))}
            </ul>
          </>
        ) : (
          <p className="muted">暂无模型评分</p>
        )}
      </section>
    </div>
  );
}
