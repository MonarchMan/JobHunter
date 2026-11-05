/** 从当前职位列构造领域输入；不持久化重复正文或历史快照。 */
export const currentJobContentSql = `(SELECT content_id AS id, id AS job_id,
 1 AS revision_no, content_hash, source_payload_hash, source_url, updated_at AS created_at, '[]' AS change_set_json,
 json_object('companyId',company_id,'sourceId',source_id,'externalJobId',external_job_id,
 'title',title,'department',department,'jobFamily',job_family,'jobSubfamily',job_subfamily,
 'locations',json(locations_json),'employmentType',employment_type,
 'recruitmentCategory',recruitment_category,'experienceText',experience_text,
 'educationText',education_text,'description',description,'detailUrl',detail_url,
 'applyUrl',apply_url,'publishedAt',published_at) AS snapshot_json FROM jobs)`;
