import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import summary from "../fixtures/antigravity-quota/summary.json" with { type: "json" };
import { harnessQuotaLooksExhausted, harnessQuotaResetAt, HARNESS_QUOTA_STALE_MS } from "../../shared/harness-limits.ts";
import type { Harness, HarnessQuota } from "../../shared/types.ts";
import {
  antigravityTokenPath,
  fetchAntigravityQuota,
  parseAntigravityQuotaSummary,
  readAntigravityToken,
} from "./antigravity-usage.ts";
import { fetchCopilotQuota, parseCopilotUsage, readCopilotToken } from "./copilot-usage.ts";

function harness(kind: Harness["kind"], home: string | null, env: Record<string, string> = {}): Harness {
  return { id: `${kind}-t`, kind, label: kind, isBuiltin: false, home, bin: null, env, enabled: true } as Harness;
}

describe("parseCopilotUsage", () => {
  test("premium meter with used/total and the monthly reset; unlimited snapshots skipped", () => {
    const meters = parseCopilotUsage({
      copilot_plan: "individual",
      quota_reset_date: "2026-12-01",
      quota_snapshots: {
        chat: { unlimited: true, percent_remaining: 100 },
        completions: { unlimited: true, percent_remaining: 100 },
        premium_interactions: { unlimited: false, percent_remaining: 88.1, quota_remaining: 176.3, entitlement: 200 },
      },
    });
    expect(meters).toEqual([
      {
        id: "premium_interactions",
        label: "Premium requests · 24/200",
        usedPercent: 12,
        resetsAtMs: Date.parse("2026-12-01T00:00:00Z"),
      },
    ]);
  });

  test("garbage in → no meters", () => {
    expect(parseCopilotUsage(null)).toEqual([]);
    expect(parseCopilotUsage({ quota_snapshots: { x: { percent_remaining: "a" } } })).toEqual([]);
  });
});

describe("readCopilotToken", () => {
  test("picks the last logged-in github.com account from JSONC config.json", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "agetor-copilot-"));
    writeFileSync(
      path.join(dir, "config.json"),
      `// managed automatically\n{"lastLoggedInUser":{"host":"https://github.com","login":"b"},` +
        `"authTokens":{"https://github.com:a":{"token":"ta"},"https://github.com:b:github":{"token":"tb2"},"https://github.com:b":{"token":"tb"}}}`,
    );
    expect(readCopilotToken(harness("copilot", dir))).toBe("tb");
  });

  test("missing file or GHE host → null, and the provider says unavailable", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "agetor-copilot-"));
    expect(readCopilotToken(harness("copilot", dir))).toBeNull();
    writeFileSync(
      path.join(dir, "config.json"),
      `{"lastLoggedInUser":{"host":"https://ghe.example","login":"a"},"authTokens":{"https://ghe.example:a":{"token":"t"}}}`,
    );
    expect(readCopilotToken(harness("copilot", dir))).toBeNull();
    const q = await fetchCopilotQuota(harness("copilot", dir));
    expect(q.status).toBe("unavailable");
  });
});

describe("Antigravity quota windows", () => {
  const now = Date.parse("2026-01-01T00:00:00Z");
  const quota = (gemini: number, thirdParty: number): HarnessQuota => {
    const body = structuredClone(summary);
    for (const group of body.groups) {
      for (const bucket of group.buckets) {
        bucket.remainingFraction = bucket.bucketId.startsWith("gemini") ? gemini : thirdParty;
      }
    }
    return {
      harnessId: "agy", kind: "antigravity", status: "ok", source: "api", planType: null,
      reason: null, fetchedAtMs: now, meters: parseAntigravityQuotaSummary(body),
    };
  };
  const blocked = (snapshot: HarnessQuota, model: string, at = now) =>
    harnessQuotaLooksExhausted(snapshot, at, HARNESS_QUOTA_STALE_MS, model);

  test("equal windows keep four distinct meters and the provider model names", () => {
    const meters = quota(1, 1).meters;
    expect(meters.map((meter) => meter.id)).toEqual(["gemini-weekly", "gemini-5h", "3p-weekly", "3p-5h"]);
    expect(meters[0]).toMatchObject({ scope: "Gemini", scopeModels: "Gemini 3.8 Flash", usedPercent: 0 });
    expect(meters[2]).toMatchObject({ scope: "Claude / GPT-OSS", scopeModels: "Claude Sonnet 4.6, Claude Opus 4.6, GPT-OSS 120B" });
  });

  test("an exhausted pool blocks only its models and uses its latest exhausted reset", () => {
    const geminiFull = quota(0, 1);
    expect(blocked(geminiFull, "gemini-3.8-flash-high")).toBe(true);
    expect(blocked(geminiFull, "claude-sonnet-4-6")).toBe(false);
    expect(blocked(quota(1, 0), "gemini-3.8-flash-high")).toBe(false);
    expect(blocked(quota(1, 0), "claude-opus-4-6")).toBe(true);
    expect(blocked(quota(1, 0), "gpt-oss-120b-medium")).toBe(true);
    expect(blocked(geminiFull, "unknown-model")).toBe(false);
    expect(harnessQuotaResetAt(geminiFull, now, HARNESS_QUOTA_STALE_MS, "gemini-3.8-flash-high"))
      .toBe(Date.parse("2026-01-08T00:00:00Z"));
  });

  test("a full window without a reset does not promise availability at another window's reset", () => {
    const snapshot = quota(0, 1);
    snapshot.meters[1]!.resetsAtMs = null;
    expect(blocked(snapshot, "gemini-3.8-flash-high")).toBe(true);
    expect(harnessQuotaResetAt(snapshot, now, HARNESS_QUOTA_STALE_MS, "gemini-3.8-flash-high")).toBeNull();
  });

  test("headroom, stale snapshots and unreported windows stay out of the block decision", () => {
    expect(blocked(quota(0.001, 1), "gemini-3.8-flash-high")).toBe(false);
    expect(blocked(quota(0, 1), "gemini-3.8-flash-high", now + HARNESS_QUOTA_STALE_MS + 1)).toBe(false);
    const partial = { ...quota(0, 1), meters: quota(0, 1).meters.filter((meter) => meter.scope !== "Gemini") };
    expect(blocked(partial, "gemini-3.8-flash-high")).toBe(false);
    expect(parseAntigravityQuotaSummary(null)).toEqual([]);
    expect(parseAntigravityQuotaSummary({ groups: [{ buckets: [
      { bucketId: "gemini-5h", remainingFraction: -1 },
      { bucketId: "other-weekly", remainingFraction: 0 },
    ] }] })).toEqual([]);
  });
});

describe("antigravity token", () => {
  function plant(home: string, token: object) {
    const p = antigravityTokenPath(harness("antigravity", home));
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(token));
  }

  test("HOME resolution: env HOME, then harness.home", () => {
    expect(antigravityTokenPath(harness("antigravity", "/h"))).toBe("/h/.gemini/antigravity-cli/antigravity-oauth-token");
    expect(antigravityTokenPath(harness("antigravity", "/h", { HOME: "/e" }))).toBe(
      "/e/.gemini/antigravity-cli/antigravity-oauth-token",
    );
  });

  test("reads the Go nanosecond expiry", () => {
    const home = mkdtempSync(path.join(tmpdir(), "agetor-agy-"));
    plant(home, { token: { access_token: "x", expiry: "2026-11-15T14:26:45.19185088-06:00" } });
    expect(readAntigravityToken(harness("antigravity", home))).toEqual({
      accessToken: "x",
      expiresAtMs: Date.parse("2026-11-15T20:26:45.191Z"),
    });
  });

  test("an expired token is unavailable without touching the network", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "agetor-agy-"));
    plant(home, { token: { access_token: "x", expiry: "2020-01-01T00:00:00Z" } });
    const q = await fetchAntigravityQuota(harness("antigravity", home));
    expect(q.status).toBe("unavailable");
    expect(q.reason).toContain("run agy");
  });

  test("no token file → unavailable", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "agetor-agy-"));
    expect(readAntigravityToken(harness("antigravity", home))).toBeNull();
    expect((await fetchAntigravityQuota(harness("antigravity", home))).status).toBe("unavailable");
  });
});
