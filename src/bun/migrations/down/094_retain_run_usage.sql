BEGIN;
CREATE TABLE run_usage_with_fk (
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

INSERT INTO run_usage_with_fk (id, run_id, task_id, harness, model, effort, input, cache_write, cache_read, output,
  reasoning, provider_total, subagent_persona, created_at)
SELECT u.id, u.run_id, u.task_id, u.harness, u.model, u.effort, u.input, u.cache_write, u.cache_read, u.output,
  u.reasoning, u.provider_total, u.subagent_persona, u.created_at
FROM run_usage u JOIN runs r ON r.id = u.run_id AND r.task_id = u.task_id
JOIN tasks t ON t.id = u.task_id;

DROP TABLE run_usage;
ALTER TABLE run_usage_with_fk RENAME TO run_usage;
CREATE INDEX idx_run_usage_run ON run_usage(run_id);
CREATE INDEX idx_run_usage_task ON run_usage(task_id);
DELETE FROM _migrations WHERE id = '094_retain_run_usage';
COMMIT;
