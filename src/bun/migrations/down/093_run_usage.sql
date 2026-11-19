BEGIN;
DROP TABLE run_usage;
ALTER TABLE runs DROP COLUMN usage_kind;
ALTER TABLE runs DROP COLUMN usage_model;
ALTER TABLE runs DROP COLUMN usage_effort;
ALTER TABLE runs DROP COLUMN usage_profile_id;
ALTER TABLE runs DROP COLUMN usage_profile_name;
DELETE FROM _migrations WHERE id IN ('087_run_usage', '093_run_usage');
COMMIT;
