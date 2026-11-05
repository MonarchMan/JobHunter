import { defaultMatchRulesetId } from '../rulesets.js';
import { scoreWeights } from '../score-composition.js';
/** metadata 的领域读取投影；数据库仅保存精简 JSON，不复制展示文案。 */
const components = `json((SELECT json_group_array(json_object(
 'dimension',json_extract(c.value,'$.dimension'),'score',json_extract(c.value,'$.score'),
 'maximumScore',json_extract(c.value,'$.max_score'),'matchedEvidence',json('[]'),
 'missingEvidence',json('[]'),'uncertainties',json('[]')))
 FROM json_each(m.value,'$.components') c))`;
const modelComponent = `json_object('dimension','model',
 'score',json_extract(m.value,'$.model.score')*${String(scoreWeights.model)},'maximumScore',${String(scoreWeights.model * 100)},
 'modelScore',json_extract(m.value,'$.model.score'),
 'matchedEvidence',json((SELECT json_group_array(json_object('source','enrichment','path','/fitScore','summary',reason.value)) FROM json_each(m.value,'$.model.reasons') reason)),
 'missingEvidence',json('[]'),'uncertainties',json('[]'))`;

/** 当前评分投影供已有应用契约读取；只有风险和未知项需要还原规则身份。 */
export const matchMetadataSql = `(SELECT m.id,m.job_id,
 json_extract(value,'$.profile_version_id') AS profile_version_id,
 json_extract(value,'$.content_id') AS job_revision_id,
 json_extract(value,'$.enrichment_id') AS job_enrichment_id,
 '${defaultMatchRulesetId}' AS ruleset_id,
 json_extract(value,'$.rules_hash') AS rules_hash,
 json_extract(value,'$.filter_status') AS filter_status,
 json_extract(value,'$.total_score') AS total_score,
 json_extract(value,'$.model.score') AS model_score,
 CASE WHEN json_extract(value,'$.model') IS NULL THEN ${components}
 ELSE json_insert(${components},'$[#]',${modelComponent}) END AS components_json,
 (SELECT json_group_array(json_object('ruleId',rule_id,'status',status,'evidence',json('[]'),'explanation',rule_id)) FROM (
 SELECT value AS rule_id,'fail' AS status FROM json_each(m.value,'$.risk_results')
 UNION ALL SELECT value,'unknown' FROM json_each(m.value,'$.unknown_rules'))) AS risks_json,
 json_extract(value,'$.input_hash') AS input_hash,m.updated_at AS created_at
 FROM job_metadata m WHERE name='match_result')`;

/** 当前解析结果投影。 */
export const enrichmentMetadataSql = `(SELECT id,job_id,
 json_extract(value,'$.content_id') AS job_revision_id,
 json_extract(value,'$.agent_run_id') AS agent_run_id,
 json_extract(value,'$.schema') AS schema_version,
 json_extract(value,'$.content_hash') AS content_hash,
 json_extract(value,'$.result') AS result_json,updated_at AS created_at
 FROM job_metadata WHERE name='enrichment')`;

/** 当前建议投影。 */
export const adviceMetadataSql = `(SELECT id,job_id,
 json_extract(value,'$.match_result_id') AS match_result_id,
 json_extract(value,'$.agent_run_id') AS agent_run_id,
 json_extract(value,'$.schema') AS schema_version,
 json_extract(value,'$.content_hash') AS content_hash,
 json_extract(value,'$.result') AS result_json,updated_at AS created_at
 FROM job_metadata WHERE name='match_advice')`;
