/** Stable bucket IDs from agy's retrieveUserQuotaSummary response. */
export const ANTIGRAVITY_QUOTA_POOLS = [
  { id: "gemini", label: "Gemini", windows: [
    { id: "gemini-weekly", label: "Weekly" },
    { id: "gemini-5h", label: "Five hours" },
  ] },
  { id: "3p", label: "Claude / GPT-OSS", windows: [
    { id: "3p-weekly", label: "Weekly" },
    { id: "3p-5h", label: "Five hours" },
  ] },
] as const;

export function antigravityQuotaPool(model: string | null | undefined): (typeof ANTIGRAVITY_QUOTA_POOLS)[number] | null {
  if (!model) return null;
  if (/^gemini(?:[-_]|$)/i.test(model)) return ANTIGRAVITY_QUOTA_POOLS[0];
  if (/^(?:claude|gpt[-_]oss)(?:[-_]|$)/i.test(model)) return ANTIGRAVITY_QUOTA_POOLS[1];
  return null;
}
