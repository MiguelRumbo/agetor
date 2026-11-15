# Harness: antigravity

> Moved from `CLAUDE.md`, where this was the `antigravity` bullet of “Agent command shape”. Index of all subsystem docs: the [Topic map in CLAUDE.md](../../CLAUDE.md#topic-map).

**`antigravity`** → driven through `src/bun/antigravity-tmux.ts` (Google's Antigravity CLI, binary `agy`; structurally a near-clone of the gemini/codex one-shot drivers).
Each turn is a one-shot `agy --output-format stream-json --model <id> [--dangerously-skip-permissions | --mode plan | --mode accept-edits] [--conversation <id>] -p` hosted **inside a detached per-task tmux session** (`-x 200 -y 50`) so a mid-turn run survives an agetor restart.
The prompt is a positional argv element read from the per-run prompt file — `sh -c '"$@" "$(cat <promptfile>)" > <runlog> 2>&1; echo $? > <exitfile>' sh <argv…>` — so it never enters shell text and has no argv-size cap of its own to enforce, and the exit code lands in a sibling file (`readAntigravityExitCode`).
Structured output comes from tailing the stream-json NDJSON log (`dataDir/antigravity-logs/<runId>.jsonl`); `mapAntigravityEvent` maps `init` (conversation id), `step_update` (an `agent_response` `text_delta` → `assistant`; a `tool` step ACTIVE/DONE → `tool_use`/`tool_result` keyed `step_<index>`), `result` (`SUCCESS` → done, anything else resolves failed with its `stderr`; the `response` text is used only when no delta text was emitted) and `error`, with line uuids `antigravity:<n>` / `antigravity:result:<n>`.
The `init` event's `conversation_id` is persisted as `runs.antigravity_session_id` (migration 061) and replayed via `--conversation <id>` on follow-up turns — continuity lives in the id, not a live REPL — and boot reconciliation reattaches through `reattachAntigravitySession` only WHILE a turn is in flight (same rule as codex/gemini); the death watch emits the shared `SESSION_DIED_STATUS_PREFIX` sentinel.

**Modes**: `auto` → `--dangerously-skip-permissions`, `plan` → `--mode plan`, `ask` → `--mode accept-edits` (labelled "Accept edits").

**Effort lives in the model id suffix, not a flag**: the curated rows bake it in (`gemini-4-argon-high|medium|low`, `gemini-3.8-flash-high|…`, …), so every `MODEL_EFFORT_SUPPORT.antigravity` set is `[]`, the effort pickers collapse (the same path gemini already takes), `buildCommand` never emits `--effort` and ignores `opts.effort` (deliberately NOT routed through `modelDeclinesEffort`, so a user-typed or discovered id still launches), and migration 065 NULLed the efforts older rows had saved (plus the `lastEffort:antigravity` pref) — `DEFAULT_EFFORT.antigravity` stays `high` only to keep the record total.
The 18 curated rows (Gemini 4 Argon ×3 on top, then Gemini 3.8 Flash ×3, 3.6 ×3, 3.1 Pro ×2, Claude Opus ×3, Sonnet ×3, gpt-oss ×1) are hand-listed with effort baked in; Argon needs Google AI Ultra or an eligible Gemini Enterprise subscription, and its `gemini-4-argon-<effort>` id follows Antigravity's naming convention but is unconfirmed — antigravity is NOT in `CATALOG_SCOPED_KINDS`, so `agy models` discovery (`discoverAntigravity`, first whitespace token = id) appends any discovered-only id after the curated rows (`mergeModelOptions` rule 4) and a differently-named Argon row shows up there.
Migrations 064/065/066 (`docs/plans/add-gemini-4-argon.md`, grill `docs/plans/add-gemini-4-argon-grill.md`) are all kind-joined on `harnesses.kind`, because the `gemini-4-argon-*` and `gemini-3.7-flash*` literals are shared with Cursor's variant/base ids.
An additional-account harness isolates via a full `HOME` override (cursor/fx-style).
Install is `brew install --cask antigravity-cli`; upgrade is `agy update` (or `brew upgrade antigravity-cli` for a Homebrew install); the version probe is `agy --version`.

**Unlike codex/cursor/gemini/fx/opencode (which ship disabled — but see the auto-enable rule in [harnesses.md](harnesses.md)), migration 061 seeds the built-in `antigravity` row `enabled = 1` on purpose** — and migration 077 later seeded `copilot` enabled the same way.
Env seams: `AGETOR_ANTIGRAVITY_BIN`, `AGETOR_ANTIGRAVITY_ARGS` (spliced before the trailing `-p`) and `AGETOR_ANTIGRAVITY_DRIVER=fake`.

## Usage

`src/bun/usage/antigravity-usage.ts` feeds the topbar usage tracker (the shared poller in `src/bun/usage/poller.ts`). It reads agy's Google OAuth token from `<HOME>/.gemini/antigravity-cli/antigravity-oauth-token` (HOME: the env map's `HOME`, then `harness.home`, then the user's) and calls the same endpoint agy's `quota_manager` uses: `POST https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels` with body `{}`. Each model's `quotaInfo` has `remainingFraction` and `resetTime`. Models share pools, so there is one meter per distinct (fraction, reset), labelled by family: "Gemini", "Claude / GPT-OSS". Internal `chat_*` / `tab_*` ids are skipped.

Facts verified on 2026-11-15 against agy 1.5.9:

- The request needs a `User-Agent` starting with `antigravity`; without one it gets 403.
- The production host `cloudcode-pa` answers with every model at 100%, which is why the provider uses the `daily-` host.
- The access token lives about an hour, and agy refreshes it only while it runs. Agetor doesn't hold agy's OAuth client and never refreshes it, so an expired token (or a 401) reports `unavailable` with "run agy once to refresh it".
- The read is no-follow (`readAccountFileText`).
