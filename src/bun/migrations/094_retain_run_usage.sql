-- Snapshot reporting dimensions before task/run deletion can remove their sources.
CREATE TABLE run_usage_retained (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
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
  created_at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  pipeline_parent_id TEXT,
  pipeline_id TEXT,
  pipeline_name TEXT,
  profile_id TEXT,
  profile_name TEXT
);

INSERT INTO run_usage_retained
WITH run_usage_attribution AS (
  SELECT r.id AS run_id,
    COALESCE(r.usage_kind, h.kind, r.agent) AS kind,
    t.pipeline_parent_id,
    COALESCE(parent.pipeline_id, t.pipeline_id) AS pipeline_id,
    COALESCE(json_extract(parent.pipeline_run, '$.pipelineName'), p.name,
      parent.pipeline_id, t.pipeline_id) AS pipeline_name,
    COALESCE(r.usage_profile_id, CASE WHEN r.usage_kind IS NULL THEN t.agent_profile_id END) AS profile_id,
    COALESCE(r.usage_profile_name,
      CASE WHEN r.usage_kind IS NULL THEN json_extract(t.agent_profile, '$.name') END) AS profile_name
  FROM runs r JOIN tasks t ON t.id = r.task_id
  LEFT JOIN tasks parent ON parent.id = t.pipeline_parent_id
  LEFT JOIN pipelines p ON p.id = COALESCE(parent.pipeline_id, t.pipeline_id)
  LEFT JOIN harnesses h ON h.id = r.agent
)
SELECT u.id, u.run_id, u.task_id, u.harness, u.model, u.effort, u.input, u.cache_write, u.cache_read, u.output,
  u.reasoning, u.provider_total, u.subagent_persona, u.created_at, a.kind, a.pipeline_parent_id, a.pipeline_id, a.pipeline_name,
  CASE WHEN u.subagent_persona IS NOT NULL THEN sub.id ELSE a.profile_id END,
  COALESCE(u.subagent_persona, a.profile_name)
FROM run_usage u JOIN run_usage_attribution a USING (run_id)
LEFT JOIN agent_profiles sub ON sub.name_key = lower(u.subagent_persona);

DROP TABLE run_usage;
ALTER TABLE run_usage_retained RENAME TO run_usage;
CREATE INDEX idx_run_usage_run ON run_usage(run_id);
CREATE INDEX idx_run_usage_task ON run_usage(task_id);
CREATE INDEX idx_run_usage_pipeline_parent ON run_usage(pipeline_parent_id);
