import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { migrate } from "./migrate.ts";
import { migrations } from "./migrations/index.ts";
import rollback from "./migrations/down/087_run_usage.sql" with { type: "text" };
import type { Run, Task } from "../shared/types.ts";

test("migration 087 rolls back without affecting existing runs and can be reapplied", () => {
  using db = new Database(":memory:");
  migrate(db, migrations);
  db.run(`INSERT INTO tasks (id, title, prompt, agent, workdir, "column", created_at, updated_at)
    VALUES ('task', 't', 'p', 'codex', '/tmp', 'ready', 1, 1)`);
  db.run("INSERT INTO runs (id, task_id, agent, status, started_at) VALUES ('run', 'task', 'codex', 'succeeded', 1)");
  db.exec(rollback);
  expect(db.query("SELECT id FROM runs").get()).toEqual({ id: "run" });
  expect(db.query("SELECT name FROM sqlite_master WHERE name = 'run_usage'").get()).toBeNull();
  expect(migrate(db, migrations)).toEqual(["087_run_usage"]);
});

test("settlement records provider telemetry and exposes it through the CLI and SSE", async () => {
  const { agentProfiles, pipelines, runs, runUsage, tasks } = await import("./db.ts");
  const { createTask } = await import("./orchestrator.ts");
  const { antigravityLogPath } = await import("./antigravity-tmux.ts");
  const { startApiServer } = await import("./server.ts");
  const { CLI_TOKEN } = await import("./api-config.ts");
  const { newStep } = await import("../shared/pipeline.ts");
  const root = mkdtempSync(path.join(tmpdir(), "agetor-run-usage-"));
  const env = { CLAUDE_CONFIG_DIR: root, CODEX_HOME: root, AGETOR_API_PORT: "0" };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);

  const profile = agentProfiles.insert({ name: "Fixture Main", harness: "claude-code", model: "sonnet" });
  const persona = agentProfiles.insert({ name: "Fixture Review", harness: "claude-code", model: "sonnet" });
  const step = newStep({ name: "Review", agentProfileId: profile.id });
  const pipeline = pipelines.insert({
    name: `Usage fixture ${randomUUID()}`, graph: { steps: [step], edges: [], startStepId: step.id }, maxSteps: 3,
  });
  const taskIds: string[] = [];
  let agyLog: string | undefined;
  const server = startApiServer();
  const controller = new AbortController();
  const reader = (await fetch(`http://127.0.0.1:${server.port}/events`, {
    headers: { Authorization: `Bearer ${CLI_TOKEN}` }, signal: controller.signal,
  })).body!.getReader();

  const fixture = (name: string, destination: string) => {
    mkdirSync(path.dirname(destination), { recursive: true });
    copyFileSync(path.join(import.meta.dir, "fixtures", "run-usage", name), destination);
  };
  const create = async (agent: string, asStep?: Task): Promise<Task> => {
    const result = await createTask({
      title: `Usage fixture ${agent}`, prompt: "placeholder", agent, isolation: "none",
      ...(agent === "claude-code" ? { agentProfileId: profile.id } : {}),
      ...(agent === "pipeline" ? { pipelineId: pipeline.id, agent: undefined } : {}),
    });
    if ("error" in result) throw new Error(result.error);
    const task = result.task;
    taskIds.push(task.id);
    if (asStep) {
      const child = { ...task, id: randomUUID(), pipelineParentId: asStep.id, pipelineStepId: step.id };
      tasks.insert(child);
      taskIds.push(child.id);
      return child;
    }
    return task;
  };
  const start = (task: Task, session: string) => {
    const run: Run = {
      id: randomUUID(), taskId: task.id, agent: task.agent, status: "running",
      startedAt: Date.parse("2026-01-01T00:00:10Z"), endedAt: null, exitCode: null, tmuxSession: null,
      claudeSessionId: task.agent === "claude-code" ? session : null,
      codexSessionId: task.agent === "codex" ? session : null,
      cursorSessionId: null, geminiSessionId: null, fxSessionId: null,
    };
    runs.insert(run);
    return run;
  };

  try {
    const parent = await create("pipeline");
    const claude = start(await create("claude-code", parent), randomUUID());
    const codex = start(await create("codex"), randomUUID());
    const agy = start(await create("antigravity"), randomUUID());
    const missing = start(await create("codex"), randomUUID());
    const project = path.join(root, "projects", "fixture-project");
    fixture("claude.jsonl", path.join(project, `${claude.claudeSessionId}.jsonl`));
    fixture("claude-subagent.jsonl", path.join(project, claude.claudeSessionId!, "subagents", "agent-fixture.jsonl"));
    fixture("claude-subagent.meta.json", path.join(project, claude.claudeSessionId!, "subagents", "agent-fixture.meta.json"));
    fixture("codex.jsonl", path.join(root, "sessions", "2026", "01", "01", `rollout-fixture-${codex.codexSessionId}.jsonl`));
    agyLog = antigravityLogPath(agy.id);
    fixture("antigravity.jsonl", agyLog);
    const expected = new Set([claude.id, codex.id, agy.id, missing.id]);
    for (const id of expected) {
      runs.update(id, { status: "succeeded", endedAt: Date.parse("2026-01-01T00:00:20Z"), exitCode: 0 });
    }
    const timeout = setTimeout(() => controller.abort(), 4000);
    try {
      const decoder = new TextDecoder();
      let pending = "";
      while (expected.size) {
        const { value, done } = await reader.read();
        if (done) throw new Error("SSE closed before telemetry was recorded");
        pending += decoder.decode(value, { stream: true });
        const frames = pending.split("\n\n");
        pending = frames.pop()!;
        for (const frame of frames) {
          if (!frame.startsWith("data: ")) continue;
          const event = JSON.parse(frame.slice(6));
          if (event.kind !== "usage.updated" || !expected.has(event.runId)) continue;
          expect(event.taskId).toBe(runs.get(event.runId)?.taskId);
          expected.delete(event.runId);
        }
      }
    } finally {
      clearTimeout(timeout);
      controller.abort();
    }

    expect(runUsage.listForRun(claude.id)).toMatchObject([
      { model: "claude-example", input: 10, cacheWrite: 7, cacheRead: 23, output: 5, subagentPersona: null },
      { model: "claude-mini", input: 2, output: 3, subagentPersona: persona.name },
    ]);
    expect(runUsage.listForRun(codex.id)).toMatchObject([
      { model: "codex-example", input: 70, cacheRead: 25, output: 20, reasoning: 5 },
    ]);
    expect(runUsage.listForRun(agy.id)).toMatchObject([
      { model: "agy-example", input: 8, cacheRead: 4, output: 4, reasoning: 2 },
    ]);
    expect(runUsage.listForRun(missing.id)).toMatchObject([
      { input: null, output: null, reasoning: null },
    ]);
    expect(runUsage.summaryForRun(codex.id)?.total).toBe(90);
    expect(runUsage.summaryForRun(agy.id)?.total).toBe(14);

    const cli = async (...args: string[]) => {
      // The CLI discovers this in-process server through the normal credential file.
      const child = Bun.spawn([process.execPath, "src/cli/index.ts", ...args, "--json", "--no-daemon", "--data-dir", root],
        { stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      if (code) throw new Error(stderr || stdout);
      expect(stdout).not.toContain("FIXTURE_PRIVATE_TEXT");
      return JSON.parse(stdout);
    };
    await Bun.write(path.join(root, "agetor-core.json"), JSON.stringify({
      port: server.port, token: CLI_TOKEN, pid: process.pid, kind: "app", version: "1.2.0", startedAt: Date.now(),
    }));
    expect((await cli("show", codex.taskId)).runs[0].usage.total).toBe(90);
    expect((await cli("ls")).find((task: Task) => task.id === parent.id).usage.total).toBe(50);
    const status = await cli("pipeline", "status", parent.id);
    expect(status.usage.total).toBe(50);
    expect(status.steps[0].usage.total).toBe(50);
    const report = await cli("usage", "--pipeline", pipeline.name, "--by", "model", "--since", "2026-01-01");
    expect(report.total.total).toBe(50);
    expect(report.groups.map((group: { key: string }) => group.key)).toEqual(["claude-example", "claude-mini"]);
    expect((await cli("usage", "--profile", profile.id)).total.total).toBe(45);
    expect((await cli("usage", "--profile", persona.id, "--by", "profile")).groups).toMatchObject([
      { key: persona.name, total: 5 },
    ]);
    expect((await cli("usage", "--pipeline", pipeline.id, "--since", "2026-01-02")).items).toEqual([]);
  } finally {
    controller.abort();
    server.stop(true);
    for (const id of taskIds.reverse()) tasks.delete(id);
    pipelines.delete(pipeline.id);
    agentProfiles.delete(profile.id);
    agentProfiles.delete(persona.id);
    if (agyLog) rmSync(agyLog, { force: true });
    rmSync(root, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}, 15000);
