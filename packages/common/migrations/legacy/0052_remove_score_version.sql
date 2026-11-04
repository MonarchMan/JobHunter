-- model_score 是否为空已经表达规则降级或加权，不再重复保存版本标识。
ALTER TABLE match_results DROP COLUMN scoring_version;
