-- 画像一级属性成为独立列；只保存确认后的事实或待确认候选，不保留双份整图。
ALTER TABLE profile_versions ADD COLUMN matching_constraints_json TEXT NOT NULL DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE profile_versions ADD COLUMN basic_info_json TEXT NOT NULL DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE profile_versions ADD COLUMN target_roles_json TEXT NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE profile_versions ADD COLUMN intended_roles_json TEXT NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE profile_versions ADD COLUMN preferences_json TEXT NOT NULL DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE profile_versions ADD COLUMN education_json TEXT NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE profile_versions ADD COLUMN work_experience_json TEXT NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE profile_versions ADD COLUMN projects_json TEXT NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE profile_versions ADD COLUMN works_json TEXT NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE profile_versions ADD COLUMN competitions_json TEXT NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE profile_versions ADD COLUMN certificates_json TEXT NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE profile_versions ADD COLUMN languages_json TEXT NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE profile_versions ADD COLUMN professional_skills TEXT;
--> statement-breakpoint
ALTER TABLE profile_versions ADD COLUMN self_evaluation TEXT;
--> statement-breakpoint
ALTER TABLE profile_versions ADD COLUMN skills_json TEXT NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE profile_versions ADD COLUMN domains_json TEXT NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE profile_versions ADD COLUMN years_of_experience REAL;
--> statement-breakpoint
ALTER TABLE profile_versions ADD COLUMN management_experience INTEGER;
--> statement-breakpoint
UPDATE profile_versions SET matching_constraints_json = COALESCE(json_extract(effective_json,'$.matchingConstraints'),'{}'),
  basic_info_json = COALESCE(json_extract(effective_json,'$.basicInfo'),'{}'),
  target_roles_json = COALESCE(json_extract(effective_json,'$.targetRoles'),'[]'),
  intended_roles_json = COALESCE(json_extract(effective_json,'$.intendedRoles'),'[]'),
  preferences_json = COALESCE(json_extract(effective_json,'$.preferences'),'{}'),
  education_json = COALESCE(json_extract(effective_json,'$.education'),'[]'),
  work_experience_json = COALESCE(json_extract(effective_json,'$.workExperience'),'[]'),
  projects_json = COALESCE(json_extract(effective_json,'$.projects'),'[]'),
  works_json = COALESCE(json_extract(effective_json,'$.works'),'[]'),
  competitions_json = COALESCE(json_extract(effective_json,'$.competitions'),'[]'),
  certificates_json = COALESCE(json_extract(effective_json,'$.certificates'),'[]'),
  languages_json = COALESCE(json_extract(effective_json,'$.languages'),'[]'),
  professional_skills = json_extract(effective_json,'$.professionalSkills'),
  self_evaluation = json_extract(effective_json,'$.selfEvaluation'),
  skills_json = COALESCE(json_extract(effective_json,'$.skills'),'[]'),
  domains_json = COALESCE(json_extract(effective_json,'$.domains'),'[]'),
  years_of_experience = json_extract(effective_json,'$.yearsOfExperience'),
  management_experience = json_extract(effective_json,'$.managementExperience');
--> statement-breakpoint
UPDATE profile_versions SET projects_json = COALESCE((SELECT json_group_array(json_set(value,'$.id', profile_versions.profile_id || ':project:' || key,'$.local_path',NULL)) FROM json_each(profile_versions.projects_json)), '[]');
--> statement-breakpoint
ALTER TABLE profile_versions DROP COLUMN effective_json;
--> statement-breakpoint
ALTER TABLE profile_versions DROP COLUMN extracted_json;
--> statement-breakpoint
ALTER TABLE profile_versions DROP COLUMN locked_paths_json;
--> statement-breakpoint
ALTER TABLE profile_versions ADD COLUMN is_candidate INTEGER NOT NULL DEFAULT 0 CHECK(is_candidate IN (0,1));
--> statement-breakpoint
ALTER TABLE profile_versions ADD COLUMN base_version_id TEXT;
