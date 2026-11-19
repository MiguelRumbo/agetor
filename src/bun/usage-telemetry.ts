import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { agentProfiles, dataDir, harnesses, runUsage, runs, subagents } from "./db.ts";
import { antigravityLogPath } from "./antigravity-tmux.ts";
import { claudeConfigDirFor, codexHomeFor } from "./harness-config-root.ts";
import { isPlainDirBelow, openReadNoFollow, readTextNoFollow } from "./no-follow.ts";
import type { Run, RunUsage } from "../shared/types.ts";

const counters = ["input", "cacheWrite", "cacheRead", "output", "reasoning"] as const;
type Counts = Pick<RunUsage, (typeof counters)[number]>;
type Sample = Counts & Pick<RunUsage, "model" | "subagentPersona"> & { providerTotal?: number };

const empty: Counts = { input: null, cacheWrite: null, cacheRead: null, output: null, reasoning: null };
const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const hasCounts = (usage: Counts) => counters.some((key) => usage[key] !== null);

type Projection = { [key: string]: true | Projection };
const usageFields = {
  input_tokens: true, cache_creation_input_tokens: true, cache_write_tokens: true,
  cache_read_input_tokens: true, cached_input_tokens: true, cache_read_tokens: true,
  output_tokens: true, thinking_tokens: true, reasoning_output_tokens: true, total_tokens: true,
} as const;
const tokenEvent = { type: true, info: { total_token_usage: usageFields } } as const;
const telemetryFields = {
  ...tokenEvent,
  event: true, timestamp: true, conversation_id: true,
  message: { id: true, model: true, usage: usageFields },
  payload: { ...tokenEvent, model: true },
  init: { model: true },
  step_update: { conversation_id: true, step_index: true, state: true, usage: usageFields },
} as const;

type Projected<P extends Projection> = {
  [K in keyof P]?: P[K] extends Projection ? Projected<P[K]> : unknown;
};

// Walk JSON syntax without decoding the values of unselected fields.
function projectJson<P extends Projection>(line: string, fields: P): Projected<P> {
  const token = /\s*("(?:[^"\\\x00-\x1f]|\\.)*"|[{}\[\],:]|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/y;
  const next = () => {
    const value = token.exec(line)?.[1];
    if (value === undefined) throw new Error("invalid JSON token");
    return value;
  };
  const read = (first: string, selection: Projection): Record<string, unknown> => {
    if (first !== "{") throw new Error("expected JSON object");
    const result: Record<string, unknown> = {};
    let key = next();
    while (key !== "}") {
      if (!key.startsWith('"') || next() !== ":") throw new Error("invalid JSON key");
      const name = JSON.parse(key) as string;
      const field = Object.hasOwn(selection, name) ? selection[name] : undefined;
      const value = next();
      if (field && field !== true && value === "{") {
        result[name] = read(value, field);
      } else if (value === "{" || value === "[") {
        let depth = 1;
        while (depth > 0) {
          const nested = next();
          if (nested === "{" || nested === "[") depth++;
          if (nested === "}" || nested === "]") depth--;
        }
      } else if (field === true) {
        result[name] = JSON.parse(value);
      }
      const separator = next();
      if (separator === "}") break;
      if (separator !== ",") throw new Error("invalid JSON separator");
      key = next();
    }
    return result;
  };
  const result = read(next(), fields);
  if (line.slice(token.lastIndex).trim()) throw new Error("invalid JSON suffix");
  return result as Projected<P>;
}

// Only the adapters' metadata fields are consumed. Bound the size of any
// individual record and stream the file so old transcripts cannot block the core.
async function* records(file: string) {
  const maxLine = 4 * 1024 * 1024;
  try {
    const stream = createReadStream(file, { fd: openReadNoFollow(file), encoding: "utf8" });
    let line = "";
    let oversized = false;
    for await (const chunk of stream) {
      const parts = (chunk as string).split("\n");
      for (let i = 0; i < parts.length; i++) {
        if (!oversized && line.length + parts[i]!.length <= maxLine) line += parts[i];
        else oversized = true;
        if (i === parts.length - 1) break;
        if (!oversized) {
          try { yield projectJson(line, telemetryFields); } catch { /* malformed record */ }
        }
        line = "";
        oversized = false;
      }
    }
    // A writer may still be appending. Accept a final record only if it parses.
    if (!oversized && line) {
      yield projectJson(line, telemetryFields);
    }
  } catch { /* absent, inaccessible or incomplete log */ }
}

async function entries(dir: string) {
  return readdir(dir, { withFileTypes: true }).catch(() => []);
}

async function findLog(dir: string, matches: (name: string) => boolean, depth: number): Promise<string | null> {
  for (const entry of await entries(dir)) {
    if (entry.isFile() && matches(entry.name)) return path.join(dir, entry.name);
    if (entry.isDirectory() && depth > 0) {
      const found = await findLog(path.join(dir, entry.name), matches, depth - 1);
      if (found) return found;
    }
  }
  return null;
}

function add(target: Counts, sample: Counts) {
  for (const key of counters) {
    const value = sample[key];
    if (value !== null) target[key] = (target[key] ?? 0) + value;
  }
}

function timestamp(value: unknown): number {
  return typeof value === "string" ? Date.parse(value) : NaN;
}

function persona(description: unknown, profiles: string[]): string | null {
  if (typeof description !== "string") return null;
  const prefix = description.trimStart().toLowerCase();
  return profiles.find((name) => {
    const key = name.toLowerCase();
    return prefix.startsWith(key) && /^(?:$|[\s:–—-])/.test(prefix.slice(key.length));
  }) ?? null;
}

async function claudeUsage(run: Run, root: string, end: number): Promise<Sample[]> {
  const sid = run.claudeSessionId;
  if (!sid || !isPlainDirBelow(root, path.join(root, "projects"))) return [];
  const file = await findLog(path.join(root, "projects"), (name) => name === `${sid}.jsonl`, 1);
  if (!file) return [];

  const dir = path.join(path.dirname(file), path.basename(file, ".jsonl"), "subagents");
  const profiles = agentProfiles.list().map((p) => p.name).sort((a, b) => b.length - a.length);
  const known = new Map(subagents.listForTask(run.taskId).map((sub) => [sub.sourcePath, sub]));
  const priorIds = new Set<string>();
  const messages = new Map<string, Sample>();
  const read = async (source: string, name: string | null, cutoff: number) => {
    for await (const row of records(source)) {
      if (row.type !== "assistant") continue;
      const msg = row.message;
      const at = timestamp(row.timestamp);
      if (!Number.isFinite(at) || at > cutoff || typeof msg?.id !== "string" || !msg.usage) continue;
      if (at < run.startedAt) {
        priorIds.add(msg.id);
        continue;
      }
      const u = msg.usage;
      const previous = messages.get(msg.id);
      const sample: Sample = {
        model: typeof msg.model === "string" ? msg.model : previous?.model ?? null,
        subagentPersona: name ?? previous?.subagentPersona ?? null,
        input: count(u.input_tokens) ?? previous?.input ?? null,
        cacheWrite: count(u.cache_creation_input_tokens) ?? previous?.cacheWrite ?? null,
        cacheRead: count(u.cache_read_input_tokens) ?? previous?.cacheRead ?? null,
        output: count(u.output_tokens) ?? previous?.output ?? null,
        reasoning: count(u.thinking_tokens) ?? previous?.reasoning ?? null,
      };
      if (hasCounts(sample)) messages.set(msg.id, sample);
    }
  };

  await read(file, null, end);
  if (isPlainDirBelow(root, dir)) {
    for (const entry of await entries(dir)) {
      if (!entry.isFile() || !/^agent-.*\.jsonl$/.test(entry.name)) continue;
      const source = path.join(dir, entry.name);
      const sub = known.get(source);
      if (sub?.runId && sub.runId !== run.id) continue;
      let description: unknown = sub?.description;
      if (!description) {
        try {
          description = projectJson(readTextNoFollow(source.replace(/\.jsonl$/, ".meta.json"), { maxBytes: 64 * 1024 }), { description: true }).description;
        } catch { /* metadata is optional */ }
      }
      await read(source, persona(description, profiles), Math.max(end, sub?.endedAt ?? end));
    }
  }
  const groups = new Map<string, Sample>();
  for (const [id, sample] of messages) {
    if (priorIds.has(id)) continue;
    const key = JSON.stringify([sample.model, sample.subagentPersona]);
    const total = groups.get(key);
    if (total) add(total, sample);
    else groups.set(key, sample);
  }
  return [...groups.values()];
}

async function codexUsage(run: Run, root: string, end: number): Promise<Sample[]> {
  const sid = run.codexSessionId;
  const sessions = path.join(root, "sessions");
  if (!sid || !isPlainDirBelow(root, sessions)) return [];
  const file = await findLog(sessions, (name) => name.endsWith(".jsonl") && name.includes(sid), 4);
  if (!file) return [];

  let baseline: Counts = empty;
  let latest: Counts | null = null;
  let model: string | null = null;
  for await (const row of records(file)) {
    const at = timestamp(row.timestamp);
    if (!Number.isFinite(at) || at > end) continue;
    if (row.type === "turn_context" && typeof row.payload?.model === "string") model = row.payload.model;
    const event = row.type === "event_msg" ? row.payload : row;
    const u = event?.type === "token_count" ? event.info?.total_token_usage : null;
    if (!u) continue;
    const snapshot = {
      input: count(u.input_tokens),
      cacheWrite: null,
      cacheRead: count(u.cached_input_tokens),
      output: count(u.output_tokens),
      reasoning: count(u.reasoning_output_tokens),
    };
    if (!hasCounts(snapshot)) continue;
    if (at < run.startedAt) baseline = snapshot;
    else latest = snapshot;
  }
  if (!latest) return [];
  const delta = { ...latest };
  for (const key of counters) {
    const last = latest[key];
    const before = baseline[key];
    // A resumed provider process may reset its counters.
    if (last !== null && before !== null && last >= before) delta[key] = last - before;
  }
  return [{ ...delta, model, subagentPersona: null }];
}

async function antigravityUsage(file: string, session: string | null): Promise<Sample[]> {
  const steps = new Map<string, Counts & { total: number | null }>();
  let model: string | null = null;
  let currentConversation = session;
  for await (const row of records(file)) {
    if (row.event === "init") {
      if (typeof row.init?.model === "string") model = row.init.model;
      if (typeof row.conversation_id === "string") currentConversation = row.conversation_id;
    }
    const step = row.step_update;
    const conversation = step?.conversation_id ?? row.conversation_id ?? currentConversation;
    const u = step?.usage;
    if (step?.state !== "DONE" || !u || typeof conversation !== "string" || count(step.step_index) === null) continue;
    const sample = {
      input: count(u.input_tokens),
      cacheWrite: count(u.cache_write_tokens),
      cacheRead: count(u.cache_read_tokens),
      output: count(u.output_tokens),
      reasoning: count(u.thinking_tokens),
      total: count(u.total_tokens),
    };
    if (!hasCounts(sample) && sample.total === null) continue;
    const key = JSON.stringify([conversation, step.step_index]);
    const previous = steps.get(key);
    if (previous) {
      for (const field of counters) sample[field] ??= previous[field];
      sample.total ??= previous.total;
    }
    steps.set(key, sample);
  }
  if (!steps.size) return [];
  const total = { ...empty };
  let providerTotal = 0;
  for (const step of steps.values()) {
    add(total, step);
    providerTotal += step.total ?? counters.reduce((sum, key) => sum + (step[key] ?? 0), 0);
  }
  return [{ ...total, providerTotal, model, subagentPersona: null }];
}

export async function collectRunUsage(runId: string): Promise<RunUsage[]> {
  const run = runs.get(runId);
  const context = runUsage.context(runId);
  if (!run || !context) return [];

  const harness = harnesses.get(run.agent) ?? { home: null };
  const end = run.endedAt ?? Date.now();
  let samples: Sample[] = [];
  switch (context.kind) {
    case "claude-code":
      samples = await claudeUsage(run, claudeConfigDirFor(harness), end);
      break;
    case "codex":
      samples = await codexUsage(run, codexHomeFor(harness), end);
      break;
    case "antigravity": {
      const file = antigravityLogPath(run.id);
      if (isPlainDirBelow(dataDir, path.dirname(file))) {
        samples = await antigravityUsage(file, run.antigravitySessionId ?? null);
      }
      break;
    }
  }
  if (!samples.length) samples.push({ ...empty, model: null, subagentPersona: null });
  // A terminal collection scheduled while a pause scan was reading will run next.
  if (!runs.get(runId)) return [];
  return runUsage.replace(run, samples.map((sample) => ({
    ...sample,
    model: sample.model ?? context.model,
    effort: context.effort,
  })), end);
}
