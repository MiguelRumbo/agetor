# Native token telemetry

Agetor collects provider usage after a run settles, is orphaned during boot, or reports a blocked or paused state. Collection runs asynchronously so the agent can settle and the pipeline can continue while the logs are scanned. Each scan replaces that run's rows in one SQLite transaction. An absent or unreadable log produces a row with null counters. A reported zero stays zero. Runs that finished before migration 093 have null usage unless a later lifecycle event triggers collection.

## Provider sources

| Harness | Source and attribution |
| --- | --- |
| Claude Code | The account's `projects/*/<session>.jsonl` and `<session>/subagents/agent-*.jsonl`. Assistant messages are attributed to their run window. When a tracked background subagent finishes after its parent turn, its final counters are added to the originating run. Repeated `message.id` entries share a counter snapshot across both sources. Model comes from the provider message. A subagent description that starts with a known profile name assigns those tokens to that persona. The longest matching name wins. |
| Codex | The account's `sessions/**/rollout-*-<session>.jsonl`. The last `token_count` event with `info.total_token_usage` in the run window supplies the counters. For a continued session, the previous cumulative snapshot provides the baseline. Cached input is part of input and reasoning is part of output, so the total sums input and output once. |
| Antigravity | Agetor's `antigravity-logs/<run>.jsonl`. Completed `step_update` entries contribute once per conversation and step index. Totals use the provider's `total_tokens` when present. |
| Other harnesses | The recorder stores the run's metadata and null counters until an adapter supplies usage. |

The core resolves Claude and Codex account storage through the same configuration resolver as the drivers. It streams regular files opened with the no-follow helpers. A JSON field allowlist decodes usage and attribution metadata. The scanner skips prompt, response and tool payload values in the transcript and opens no credential files. SQLite retains numeric counters, attribution names and IDs, and a collection timestamp.

## API and CLI

- `agetor show <task> --json` includes `task.usage` and each run's `usage`.
- `agetor ls --json` includes `usage` per task. Pipeline parent totals include all their step tasks. Use `--steps` to include individual step executions.
- `agetor pipeline status <task> --json` includes top-level `usage` and `steps[].usage`. By design, these totals cover all executions attached to the parent, including retries and completed executions from before a restart.
- `agetor usage [--since <ISO>] [--pipeline <id|name>] [--profile <id|name>] [--by pipeline|profile|harness|model] [--json]` calls the authenticated `GET /run-usage`. The date filters the time of collection or run settlement. Groups count telemetry rows. A profile filter includes both direct runs and usage attributed to matching subagents. An ungrouped report includes individual rows, including each persona and model.
- `GET /events` emits live JSON frames with `kind: "usage.updated"`, `taskId`, `runId` and `ts` after the transaction commits. Read the API to get the latest counters.

Run attribution uses the harness and the launch-time model, effort and profile snapshot when the provider does not identify them. Totals aggregate available counters. Null totals mean that no counters are available.

## Database

Migration 093 creates `run_usage` and adds launch-attribution columns to `runs`. Databases that already applied the fork’s original `087_run_usage` migration register 093 as an alias without recreating its tables or counters.

Migration 094 preserves collected telemetry after task or run deletion. It snapshots the harness kind, pipeline, and profile attribution, including the subagent persona's profile when available. `agetor usage` includes retained rows in its totals and filters, and a surviving pipeline parent includes the usage of its deleted steps. Removing a card still removes its runs and transcript. Telemetry already removed by the former cascade can only be recovered from a backup that contains it.

To roll back, stop the core and apply `src/bun/migrations/down/094_retain_run_usage.sql`. It restores the original foreign keys and drops historical telemetry whose task or run has already been deleted. To remove telemetry entirely, apply `src/bun/migrations/down/093_run_usage.sql` next. A build containing the migrations reapplies them on startup.
