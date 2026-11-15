import path from "node:path";
import type { Harness, HarnessQuota, QuotaMeter } from "../../shared/types.ts";
import { copilotHome } from "../copilot-home.ts";
import { readAccountFileText } from "../no-follow.ts";

/**
 * GitHub Copilot usage provider (docs/architecture/harness-copilot.md,
 * "Usage"). Reads the GitHub OAuth token the Copilot CLI stores in
 * `$COPILOT_HOME/config.json` (`authTokens`, plaintext on Linux; macOS keeps
 * it in the keychain, which this provider does not read) and asks GitHub's
 * undocumented `copilot_internal/user` endpoint — the same one the Copilot
 * IDE extensions use — for the account's `quota_snapshots`.
 *
 * Only metered quotas become meters: on paid plans `chat` and `completions`
 * report `unlimited: true` and are skipped, so the usual result is a single
 * "Premium requests" meter. Never throws.
 */

const FETCH_TIMEOUT_MS = 10_000;
const CONFIG_MAX_BYTES = 1024 * 1024;
const GITHUB_HOST = "https://github.com";

/** Copilot writes `config.json` as JSONC with a `//` comment header. */
function parseJsonc(text: string): unknown {
  return JSON.parse(
    text
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("//"))
      .join("\n"),
  );
}

/**
 * The OAuth token of the account copilot last logged in with. `authTokens`
 * is keyed `<host>:<login>` (plus a `<host>:<login>:github` twin); only
 * github.com accounts are supported. Returns null when there is no usable
 * token (not logged in, keychain storage, GHE host, unreadable file).
 */
export function readCopilotToken(harness: Harness): string | null {
  try {
    const file = path.join(copilotHome({ harnessHome: harness.home, harnessEnv: harness.env }), "config.json");
    // COPILOT_HOME is agent-writable: no-follow read (no-follow.ts).
    const cfg = parseJsonc(readAccountFileText(file, CONFIG_MAX_BYTES)) as Record<string, unknown>;
    const tokens = cfg?.authTokens as Record<string, { token?: unknown }> | undefined;
    if (!tokens || typeof tokens !== "object") return null;
    const last = cfg.lastLoggedInUser as { host?: unknown; login?: unknown } | undefined;
    const host = typeof last?.host === "string" ? last.host : GITHUB_HOST;
    if (host !== GITHUB_HOST) return null;
    const keys = Object.keys(tokens).filter((k) => k.startsWith(`${host}:`));
    const login = typeof last?.login === "string" ? last.login : null;
    const key =
      (login && keys.find((k) => k === `${host}:${login}`)) ??
      (login && keys.find((k) => k.startsWith(`${host}:${login}:`))) ??
      keys[0];
    const token = key ? tokens[key]?.token : null;
    return typeof token === "string" && token ? token : null;
  } catch {
    return null;
  }
}

/** `YYYY-MM-DD` (the account's monthly reset day) → epoch ms at UTC midnight. */
function parseResetDate(v: unknown): number | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const ms = Date.parse(`${v}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

const SNAPSHOT_LABELS: Record<string, string> = {
  premium_interactions: "Premium requests",
  chat: "Chat",
  completions: "Completions",
};

/** Map a `copilot_internal/user` body to meters (metered snapshots only). */
export function parseCopilotUsage(body: unknown): QuotaMeter[] {
  if (!body || typeof body !== "object") return [];
  const b = body as Record<string, unknown>;
  const snaps = b.quota_snapshots;
  if (!snaps || typeof snaps !== "object") return [];
  const resetsAtMs = parseResetDate(b.quota_reset_date);
  const meters: QuotaMeter[] = [];
  for (const [id, raw] of Object.entries(snaps as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const s = raw as Record<string, unknown>;
    if (s.unlimited === true) continue;
    const pct = s.percent_remaining;
    if (typeof pct !== "number" || !Number.isFinite(pct)) continue;
    const used = Math.min(100, Math.max(0, Math.round(100 - pct)));
    let label = SNAPSHOT_LABELS[id] ?? id;
    const entitlement = s.entitlement;
    const remaining = s.quota_remaining ?? s.remaining;
    if (typeof entitlement === "number" && entitlement > 0 && typeof remaining === "number") {
      label += ` · ${Math.round(entitlement - remaining)}/${entitlement}`;
    }
    meters.push({ id, label, usedPercent: used, resetsAtMs });
  }
  return meters;
}

export async function fetchCopilotQuota(harness: Harness): Promise<HarnessQuota> {
  const fetchedAtMs = Date.now();
  const base = { harnessId: harness.id, kind: harness.kind, source: "api" as const, fetchedAtMs };
  const token = readCopilotToken(harness);
  if (!token) {
    return {
      ...base,
      planType: null,
      status: "unavailable",
      meters: [],
      reason: "No Copilot login found in config.json (run `copilot` and /login)",
    };
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch("https://api.github.com/copilot_internal/user", {
      headers: { authorization: `token ${token}`, accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      return { ...base, planType: null, status: "error", meters: [], reason: `GitHub answered HTTP ${res.status}` };
    }
    const body: unknown = await res.json().catch(() => null);
    const meters = parseCopilotUsage(body);
    const plan = (body as Record<string, unknown> | null)?.copilot_plan;
    return {
      ...base,
      planType: typeof plan === "string" ? plan : null,
      status: meters.length > 0 ? "ok" : "unavailable",
      meters,
      reason: meters.length > 0 ? null : "This Copilot plan reports no metered quota",
    };
  } catch (err) {
    const reason = controller.signal.aborted ? "GitHub request timed out" : err instanceof Error ? err.message : String(err);
    return { ...base, planType: null, status: "error", meters: [], reason };
  } finally {
    clearTimeout(timeoutId);
  }
}
