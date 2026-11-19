import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.AGETOR_DATA_DIR ??= mkdtempSync(path.join(tmpdir(), "agetor-agy-quota-"));

test("Antigravity pre-flight refuses the exhausted pool and allows a different pool on the same account", async () => {
  const { harnesses, harnessUsage, runs, tasks } = await import("./db.ts");
  const { createTask, startTask, sendInput } = await import("./orchestrator.ts");
  const previous = harnessUsage.get("antigravity");
  const harness = harnesses.get("antigravity")!;
  const driver = process.env.AGETOR_ANTIGRAVITY_DRIVER;
  const bin = process.env.AGETOR_ANTIGRAVITY_BIN;
  process.env.AGETOR_ANTIGRAVITY_DRIVER = "fake";
  process.env.AGETOR_ANTIGRAVITY_BIN = "/bin/echo";
  harnesses.setEnabled(harness.id, true);
  const ids: string[] = [];

  const create = async (model: string) => {
    const result = await createTask({ title: "Quota fixture", prompt: "first turn",
      agent: harness.id, isolation: "none", model });
    if ("error" in result) throw new Error(result.error);
    ids.push(result.task.id);
    return result.task.id;
  };
  const now = Date.now();
  const snapshot = (gemini: number, thirdParty: number) => harnessUsage.upsert({
    harnessId: harness.id, kind: "antigravity", status: "ok", source: "api",
    reason: null, planType: null, fetchedAtMs: now, meters: [
      { id: "gemini-weekly", label: "Weekly", usedPercent: gemini, resetsAtMs: now + 100_000 },
      { id: "gemini-5h", label: "Five hours", usedPercent: gemini, resetsAtMs: now + 50_000 },
      { id: "3p-weekly", label: "Weekly", usedPercent: thirdParty, resetsAtMs: now + 100_000 },
    ],
  });

  try {
    snapshot(100, 0);
    const gemini = await create("gemini-3.8-flash-high");
    expect(await startTask(gemini)).toEqual({
      error: `Antigravity quota exhausted for Gemini on ${harness.label} — retry after ${new Date(now + 100_000).toISOString()}`,
    });
    expect(runs.countForTask(gemini)).toBe(0);

    const claude = await create("claude-sonnet-4.6");
    const started = await startTask(claude);
    if ("error" in started) throw new Error(started.error);
    for (let attempt = 0; attempt < 50 && runs.hasRunning(claude); attempt++) await Bun.sleep(20);
    expect(runs.get(started.runId)?.status).toBe("succeeded");
    snapshot(0, 100);
    expect(await sendInput(started.runId, "follow-up")).toMatchObject({
      delivered: false, reason: expect.stringContaining("quota exhausted for Claude / GPT-OSS"),
    });
    expect(runs.countForTask(claude)).toBe(1);
  } finally {
    for (const id of ids) tasks.delete(id);
    if (previous) harnessUsage.upsert(previous);
    else harnessUsage.delete(harness.id);
    harnesses.setEnabled(harness.id, harness.enabled);
    if (driver === undefined) delete process.env.AGETOR_ANTIGRAVITY_DRIVER;
    else process.env.AGETOR_ANTIGRAVITY_DRIVER = driver;
    if (bin === undefined) delete process.env.AGETOR_ANTIGRAVITY_BIN;
    else process.env.AGETOR_ANTIGRAVITY_BIN = bin;
  }
});
