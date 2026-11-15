import os from "node:os";
import path from "node:path";
import type { Harness, HarnessQuota, QuotaMeter } from "../../shared/types.ts";
import { readAccountFileText } from "../no-follow.ts";

/**
 * Antigravity (`agy`) usage provider (docs/architecture/harness-antigravity.md,
 * "Usage"). Reads the Google OAuth token agy keeps in
 * `<HOME>/.gemini/antigravity-cli/antigravity-oauth-token` and calls the same
 * Cloud Code endpoint agy's own `quota_manager` uses,
 * `daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels`, whose
 * `models[id].quotaInfo` carries `remainingFraction` (0..1) and `resetTime`.
 *
 * Models share quota pools (every Gemini model reports the same fraction and
 * reset; Claude and GPT-OSS share another), so meters are one per distinct
 * (fraction, reset) pair, labelled by the model families in it. Internal ids
 * (`chat_*`, `tab_*`) are ignored.
 *
 * The access token lives about an hour and agy refreshes it only while it
 * runs; Agetor does not hold agy's OAuth client, so it never refreshes it.
 * An expired token yields `unavailable` with a hint to run agy. Never throws.
 *
 * Verified 2026-11-15 against agy 1.5.9: the request needs a `User-Agent`
 * that starts with `antigravity` (none → 403), the body can be `{}`, and the
 * production host (`cloudcode-pa`) answers with every model at 100%, which is
 * why the daily host is used.
 */

const FETCH_TIMEOUT_MS = 10_000;
const TOKEN_MAX_BYTES = 64 * 1024;
const ENDPOINT = "https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels";
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

const FAMILY_LABELS: Record<string, string> = { gemini: "Gemini", claude: "Claude", gpt: "GPT-OSS" };

function familyOf(modelId: string): string {
  const head = modelId.split(/[-_]/)[0]!.toLowerCase();
  return FAMILY_LABELS[head] ?? head.charAt(0).toUpperCase() + head.slice(1);
}

/** Map a `fetchAvailableModels` body to one meter per shared quota pool. */
export function parseAntigravityModels(body: unknown): QuotaMeter[] {
  const models = (body as { models?: unknown } | null)?.models;
  if (!models || typeof models !== "object") return [];
  const pools = new Map<string, { fraction: number; resetsAtMs: number | null; families: Set<string> }>();
  for (const [id, raw] of Object.entries(models as Record<string, unknown>)) {
    if (/^(chat|tab)_/.test(id)) continue;
    const q = (raw as { quotaInfo?: { remainingFraction?: unknown; resetTime?: unknown } } | null)?.quotaInfo;
    if (!q || typeof q.remainingFraction !== "number" || !Number.isFinite(q.remainingFraction)) continue;
    const resetsAtMs = typeof q.resetTime === "string" && Number.isFinite(Date.parse(q.resetTime)) ? Date.parse(q.resetTime) : null;
    const key = `${q.remainingFraction}|${resetsAtMs}`;
    const pool = pools.get(key) ?? { fraction: q.remainingFraction, resetsAtMs, families: new Set<string>() };
    pool.families.add(familyOf(id));
    pools.set(key, pool);
  }
  return [...pools.values()]
    .map((p) => {
      const families = [...p.families].sort();
      return {
        id: families.join("-").toLowerCase(),
        label: families.join(" / "),
        usedPercent: Math.min(100, Math.max(0, Math.round((1 - p.fraction) * 100))),
        resetsAtMs: p.resetsAtMs,
      };
    })
    .sort((a, b) => b.usedPercent - a.usedPercent || a.label.localeCompare(b.label));
}

export async function fetchAntigravityQuota(harness: Harness): Promise<HarnessQuota> {
  const fetchedAtMs = Date.now();
  const base = { harnessId: harness.id, kind: harness.kind, planType: null, source: "api" as const, fetchedAtMs };
  const token = readAntigravityToken(harness);
  if (!token) {
    return { ...base, status: "unavailable", meters: [], reason: "No Antigravity login found (run agy and sign in)" };
  }
  if (token.expiresAtMs !== null && token.expiresAtMs <= fetchedAtMs) {
    return { ...base, status: "unavailable", meters: [], reason: EXPIRED_REASON };
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token.accessToken}`,
        "content-type": "application/json",
        "user-agent": "antigravity",
      },
      body: "{}",
      signal: controller.signal,
    });
    if (res.status === 401) return { ...base, status: "unavailable", meters: [], reason: EXPIRED_REASON };
    if (!res.ok) return { ...base, status: "error", meters: [], reason: `Cloud Code answered HTTP ${res.status}` };
    const meters = parseAntigravityModels(await res.json().catch(() => null));
    return {
      ...base,
      status: meters.length > 0 ? "ok" : "unavailable",
      meters,
      reason: meters.length > 0 ? null : "Antigravity reported no model quotas",
    };
  } catch (err) {
    const reason = controller.signal.aborted ? "Cloud Code request timed out" : err instanceof Error ? err.message : String(err);
    return { ...base, status: "error", meters: [], reason };
  } finally {
    clearTimeout(timeoutId);
  }
}
