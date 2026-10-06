// Why: letters only and shorter than a credential-shaped run, so no id or token can pass as a key.
const SAFE_KEY_PATTERN = /^[A-Za-z_]{1,31}$/
const MAX_LISTED_KEYS = 32
export type JsonObject = Record<string, unknown>

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function rounded(value: number, decimals: number): number {
  return Number(value.toFixed(decimals))
}

/** Field names that are safe to list, sorted and capped; `withheld` counts the rest. */
export function safeKeys(value: unknown): { keys: string[]; withheld: number } {
  const all = isJsonObject(value) ? Object.keys(value) : []
  const keys = all.filter((key) => SAFE_KEY_PATTERN.test(key)).sort()
  return { keys: keys.slice(0, MAX_LISTED_KEYS), withheld: all.length - keys.length }
}
