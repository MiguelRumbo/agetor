-- Migration 087: Native Token Telemetry (run_usage)
-- See down/087_run_usage.sql for rollback.

CREATE TABLE IF NOT EXISTS run_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  harness TEXT NOT NULL,
  model TEXT,
  effort TEXT,
  input INTEGER,
  cache_write INTEGER,
  cache_read INTEGER,
  output INTEGER,
  reasoning INTEGER,
  provider_total INTEGER,
  subagent_persona TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_run_usage_run ON run_usage(run_id);
CREATE INDEX IF NOT EXISTS idx_run_usage_task ON run_usage(task_id);

ALTER TABLE runs ADD COLUMN usage_kind TEXT;
ALTER TABLE runs ADD COLUMN usage_model TEXT;
ALTER TABLE runs ADD COLUMN usage_effort TEXT;
ALTER TABLE runs ADD COLUMN usage_profile_id TEXT;
ALTER TABLE runs ADD COLUMN usage_profile_name TEXT;
