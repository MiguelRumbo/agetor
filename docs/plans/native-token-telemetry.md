# Native Token Telemetry in Agetor

## Context and Goal

Agetor orchestrates multiple coding agents (Claude Code, Codex, Antigravity, Cursor, Gemini, fx, Copilot, OpenCode) across single tasks and multi-step pipelines with subagent delegations. Currently, there is no unified native telemetry recording token expenditures per task, step, profile, model, or subagent persona.

This plan introduces native token telemetry:
1. Reversible SQLite migration adding `run_usage` table.
2. Pluggable adapter architecture per harness reading provider log files (Claude Code, Codex, Antigravity, and fallback null-adapters for other harnesses).
3. Attribution of subagent token expenditures to their persona (`subagent_persona`).
4. Automatic collection when a run finishes or pauses/blocks.
5. SSE global event `usage.updated` on `/events`.
6. Exposure across CLI commands: `agetor show --json`, `agetor ls --json`, `agetor pipeline status --json` (per step and total).
7. New CLI command `agetor usage [--since <ISO>] [--pipeline <n>] [--profile <n>] [--by pipeline|profile|harness|model] [--json]`.
8. UX fix for `agetor pipeline advance` on a step-cap blocked run, guiding the user to `agetor pipeline retry <id>`.

## Schema & Migration

Migration `087_run_usage.sql`:
```sql
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
  subagent_persona TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_run_usage_run ON run_usage(run_id);
CREATE INDEX IF NOT EXISTS idx_run_usage_task ON run_usage(task_id);
```

Reversal script:
```sql
DROP INDEX IF EXISTS idx_run_usage_task;
DROP INDEX IF EXISTS idx_run_usage_run;
DROP TABLE IF EXISTS run_usage;
```

## Harness Adapters

- **Claude Code**:
  - Main transcript: `~/.claude/projects/*/<claude_session_id>.jsonl`
  - Subagents: `<claude_session_id>/subagents/agent-*.jsonl` + `agent-*.meta.json` (or `subagents` table)
  - Deduplicates events by `message.id`.
  - Maps `input_tokens` -> `input`, `cache_creation_input_tokens` -> `cache_write`, `cache_read_input_tokens` -> `cache_read`, `output_tokens` -> `output`.
  - Determines `subagent_persona` from description prefix.
- **Codex**:
  - `~/.codex/sessions/**/*<codex_session_id>*.jsonl`
  - Latest `token_count` event with `info.total_token_usage`.
  - Maps `input_tokens` -> `input`, `cached_input_tokens` -> `cache_read`, `output_tokens` -> `output`, `reasoning_output_tokens` -> `reasoning`.
- **Antigravity**:
  - `$AGETOR_DATA_DIR/antigravity-logs/${runId}.jsonl`
  - `step_update` events with `state: "DONE"` and `usage`.
  - Deduplicates by `conversation_id:step_index`.
  - Maps `input_tokens` -> `input`, `cache_read_tokens` -> `cache_read`, `output_tokens` -> `output`, `thinking_tokens` -> `reasoning`.
- **Other harnesses**:
  - Returns a row with `model`, `effort` and `NULL` counts without throwing.

## Verification Plan

- Unit tests with anonymized JSONL fixtures for each harness.
- Integration tests ensuring runs produce valid rows.
- CLI tests for `show --json`, `ls --json`, `pipeline status --json`, and `usage`.
- Verification of step-cap UX improvement in `pipeline advance`.

## Implementation

The implemented contract, including attribution, API and rollback, is maintained in [native token telemetry](../architecture/run-usage.md).
