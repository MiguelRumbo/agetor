import os from "node:os";
import path from "node:path";
import type { Harness, HarnessQuota, QuotaMeter } from "../../shared/types.ts";
import { parseCliVersion } from "../../shared/cli-version.ts";
import { ANTIGRAVITY_QUOTA_POOLS } from "../../shared/antigravity-quota.ts";
import { readAccountFileText } from "../no-follow.ts";

/**
 * Antigravity (`agy`) usage provider (docs/architecture/harness-antigravity.md,
 * "Usage"). Reads the Google OAuth token agy keeps in
 * `<HOME>/.gemini/antigravity-cli/antigravity-oauth-token` and calls
 * `retrieveUserQuotaSummary` for each pool's weekly and five-hour windows.
 *
 * The access token lives about an hour and agy refreshes it only while it
 * runs; Agetor does not hold agy's OAuth client, so it never refreshes it.
 * An expired token yields `unavailable` with a hint to run agy. Never throws.
 *
 * Verified with agy 1.5.12: the summary accepts an empty JSON object on the
 * daily Cloud Code host with Antigravity's user-agent.
 */

const FETCH_TIMEOUT_MS = 10_000;
const TOKEN_MAX_BYTES = 64 * 1024;
const ENDPOINT = "https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary";
const EXPIRED_REASON = "Antigravity login token expired — run agy once to refresh it";

/** agy has no config-dir env var; an additional account is a HOME override
 *  (`harnessEnv` in agents.ts writes HOME from `harness.home`, and the env
 *  map may overwrite it). */
export function antigravityTokenPath(harness: Harness): string {
  const home = harness.env?.HOME || harness.home || os.homedir();
  return path.join(home, ".gemini", "antigravity-cli", "antigravity-oauth-token");
}

/** Go writes RFC 3339 with nanoseconds; trim the fraction to ms for Date.parse. */
function parseExpiry(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const ms = Date.parse(v.replace(/(\.\d{3})\d+/, "$1"));
  return Number.isFinite(ms) ? ms : null;
}

export function readAntigravityToken(harness: Harness): { accessToken: string; expiresAtMs: number | null } | null {
  try {
    // Agent-writable file under HOME: no-follow read (no-follow.ts).
    const parsed = JSON.parse(readAccountFileText(antigravityTokenPath(harness), TOKEN_MAX_BYTES)) as {
      token?: { access_token?: unknown; expiry?: unknown };
    };
    const t = parsed?.token;
    if (!t || typeof t.access_token !== "string" || !t.access_token) return null;
    return { accessToken: t.access_token, expiresAtMs: parseExpiry(t.expiry) };
  } catch {
    return null;
  }
}

/** Only reported buckets become meters. The UI can show missing windows explicitly. */
export function parseAntigravityQuotaSummary(body: unknown): QuotaMeter[] {
  const groups = (body as { groups?: unknown } | null)?.groups;
  if (!Array.isArray(groups)) return [];
  const buckets = new Map<string, QuotaMeter>();
  for (const group of groups) {
    if (!Array.isArray(group?.buckets)) continue;
    const scopeModels = typeof group.description === "string"
      ? /^Models within this group:\s*([^\r\n]{1,512})$/i.exec(group.description.trim())?.[1]
      : undefined;
    for (const bucket of group.buckets) {
      const id = bucket?.bucketId;
      const fraction = bucket?.remainingFraction;
      if (typeof id !== "string" || typeof fraction !== "number" ||
          !Number.isFinite(fraction) || fraction < 0 || fraction > 1) continue;
      const pool = ANTIGRAVITY_QUOTA_POOLS.find((p) => p.windows.some((window) => window.id === id));
      const window = pool?.windows.find((window) => window.id === id);
      if (!pool || !window) continue;
      buckets.set(id, {
        id,
        label: window.label,
        scope: pool.label,
        ...(scopeModels ? { scopeModels } : {}),
        // Keep positive headroom below 100 even with floating-point cancellation.
        usedPercent: fraction === 0 ? 100 : Math.min(99.999999, (1 - fraction) * 100),
        resetsAtMs: parseExpiry(bucket.resetTime),
      });
    }
  }
  return ANTIGRAVITY_QUOTA_POOLS.flatMap((pool) =>
    pool.windows.flatMap(({ id }) => {
      const meter = buckets.get(id);
      return meter ? [meter] : [];
    }),
  );
}

export async function fetchAntigravityQuota(harness: Harness, cliVersion?: string | null): Promise<HarnessQuota> {
  const fetchedAtMs = Date.now();
  const base = { harnessId: harness.id, kind: harness.kind, planType: null, source: "api" as const, fetchedAtMs };
  const token = readAntigravityToken(harness);
  if (!token) {
    return { ...base, status: "unavailable", meters: [], reason: "No Antigravity login found (run agy and sign in)" };
  }
  if (token.expiresAtMs !== null && token.expiresAtMs <= fetchedAtMs) {
    return { ...base, status: "unavailable", meters: [], reason: EXPIRED_REASON };
  }
  const version = cliVersion ? parseCliVersion(cliVersion) : null;
  const userAgent = version ? `antigravity/cli/${version.major}.${version.minor}.${version.patch}` : "antigravity/cli";
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token.accessToken}`,
        "content-type": "application/json",
        "user-agent": userAgent,
      },
      body: "{}",
      signal: controller.signal,
    });
    if (res.status === 401) return { ...base, status: "unavailable", meters: [], reason: EXPIRED_REASON };
    if (!res.ok) return { ...base, status: "error", meters: [], reason: `Cloud Code answered HTTP ${res.status}` };
    const meters = parseAntigravityQuotaSummary(await res.json().catch(() => null));
    return {
      ...base,
      status: meters.length > 0 ? "ok" : "unavailable",
      meters,
      reason: meters.length > 0 ? null : "Antigravity reported no quota windows",
    };
  } catch (err) {
    const reason = controller.signal.aborted ? "Cloud Code request timed out" : err instanceof Error ? err.message : String(err);
    return { ...base, status: "error", meters: [], reason };
  } finally {
    clearTimeout(timeoutId);
  }
}
