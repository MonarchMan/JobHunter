import { objectiveRuleRows, ruleGaps } from './match-summary.js';
import type { ReactElement } from 'react';
import type { WebJobDetail } from '@jobhunter/matching/contracts/web';
import { matchEvidenceCoverage } from '@jobhunter/matching';
import styles from './page.module.css';

type Match = WebJobDetail['matches'][number];
const names: Readonly<Record<string, string>> = {
  skills: '技能',
  experience: '经验',
  projects: '项目 / 实践',
  role: '岗位方向',
  industry: '行业',
  location: '地点',
  qualification: '客观条件',
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
  const uncertain = [
    ...new Set(
      rules
        .filter((item) => item.evidenceStatus !== 'not_applicable')
        .flatMap((item) => item.uncertainties),
    ),
  ];
  const coverage = matchEvidenceCoverage(rules);
  return (
    <div className={styles.scoreGrid}>
      <section className={styles.scoreCard} aria-label="规则评分">
        <h3>规则评分</h3>
        {rules[0]?.recruitmentCategory && (
          <p className="muted">
            招聘类别：
            {
              { social: '社招', campus: '校招', internship: '实习', unknown: '待确认' }[
                rules[0].recruitmentCategory
              ]
            }
          </p>
        )}
        <strong className={styles.scoreValue}>
          {rules.reduce((sum, item) => sum + item.score, 0).toFixed(1)} <small>/ 100</small>
        </strong>
        {coverage !== null && (
          <p className="muted">
            证据完整度 {coverage}%
            {coverage < 100 || match.filterStatus === 'uncertain' ? ' · 暂定分' : ''}
          </p>
        )}
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
        {uncertain.length > 0 && (
          <details>
            <summary>待确认</summary>
            <ul>
              {uncertain.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          </details>
        )}
        <details>
          <summary>查看匹配依据</summary>
          <ul className={styles.evidenceList}>
            {[
              ...new Set(
                rules.flatMap((item) => item.matchedEvidence.map((evidence) => evidence.summary)),
              ),
            ].map((text) => (
              <li key={text}>{text}</li>
            ))}
            {match.ruleOutcomes.map((item, index) => (
              <li key={`${item.ruleId}:${String(index)}`}>{item.explanation}</li>
            ))}
          </ul>
        </details>
      </section>
      <section className={styles.scoreCard} aria-label="模型评分">
        <h3>模型评分</h3>
        {model?.modelScore !== undefined ? (
          <>
            <strong className={styles.scoreValue}>
              {model.modelScore.toFixed(1)} <small>/ 100</small>
            </strong>
            <ul className={styles.evidenceList}>
              {model.matchedEvidence.map((item, index) => (
                <li key={index}>{item.summary}</li>
              ))}
            </ul>
          </>
        ) : (
          <p className="muted">
            {objective ? '尚未评估技能及项目 / 工作能力，当前分数仅反映客观条件。' : '暂无模型评分'}
          </p>
        )}
      </section>
    </div>
  );
}
