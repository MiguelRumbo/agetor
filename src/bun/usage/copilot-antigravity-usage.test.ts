import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Harness } from "../../shared/types.ts";
import {
  antigravityTokenPath,
  fetchAntigravityQuota,
  parseAntigravityModels,
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

describe("parseAntigravityModels", () => {
  test("one meter per shared pool, labelled by family; chat_/tab_ ids ignored", () => {
    const meters = parseAntigravityModels({
      models: {
        "gemini-2.5-pro": { quotaInfo: { remainingFraction: 0.75, resetTime: "2026-11-15T23:14:44Z" } },
        "gemini-3-flash": { quotaInfo: { remainingFraction: 0.75, resetTime: "2026-11-15T23:14:44Z" } },
        "claude-sonnet-4-6": { quotaInfo: { remainingFraction: 1, resetTime: "2026-11-16T00:15:40Z" } },
        "gpt-oss-120b-medium": { quotaInfo: { remainingFraction: 1, resetTime: "2026-11-16T00:15:40Z" } },
        chat_20706: { quotaInfo: { remainingFraction: 0 } },
        tab_flash_lite_preview: { quotaInfo: { remainingFraction: 0 } },
        "no-quota": {},
      },
    });
    expect(meters).toEqual([
      { id: "gemini", label: "Gemini", usedPercent: 25, resetsAtMs: Date.parse("2026-11-15T23:14:44Z") },
      { id: "claude-gpt-oss", label: "Claude / GPT-OSS", usedPercent: 0, resetsAtMs: Date.parse("2026-11-16T00:15:40Z") },
    ]);
  });

  test("garbage in → no meters", () => {
    expect(parseAntigravityModels(null)).toEqual([]);
    expect(parseAntigravityModels({ models: [] })).toEqual([]);
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
