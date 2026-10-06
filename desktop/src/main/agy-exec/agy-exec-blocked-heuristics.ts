import { boundText, redactSecretLikeText } from '../agent-exec-shared/secret-redaction'

// HEURISTIC: agy documents no error code for quota or auth and its wording is unverified (gate G8), so text decides, and only on a run that already failed.

export type AgyExecBlockMatch = {
  readonly reason: 'quota' | 'auth'
  readonly heuristic: true
  readonly matchedText: string
}

const QUOTA_PATTERNS: readonly RegExp[] = [
  /quota/i,
  /resource[_ ]exhausted/i,
  /rate[- ]limit/i,
  /\b429\b/,
  /too many requests/i,
  /usage limit/i,
  /out of (?:credits|usage)/i
]

const AUTH_PATTERNS: readonly RegExp[] = [
  /not (?:logged|signed) in/i,
  /please (?:log|sign) ?in/i,
  /\bunauthenticated\b/i,
  /\bunauthori[sz]ed\b/i,
  /\b401\b/,
  /authentication (?:failed|required|error)/i,
  /(?:log|sign) ?in required/i,
  /token (?:has )?(?:expired|been revoked)/i
]

const CONTEXT_CHARS = 80
const MAX_MATCHED_CHARS = 240

function snippetAround(text: string, match: RegExpExecArray): string {
  const start = Math.max(0, match.index - CONTEXT_CHARS)
  const end = Math.min(text.length, match.index + match[0].length + CONTEXT_CHARS)
  return boundText(text.slice(start, end).trim(), MAX_MATCHED_CHARS).text
}

/** Find quota or auth text in the failure channel (stderr) only; agent output must never be passed in. */
export function detectAgyExecBlock(texts: readonly string[]): AgyExecBlockMatch | null {
  for (const raw of texts) {
    const text = redactSecretLikeText(raw)
    for (const [reason, patterns] of [
      ['quota', QUOTA_PATTERNS],
      ['auth', AUTH_PATTERNS]
    ] as const) {
      for (const pattern of patterns) {
        const match = pattern.exec(text)
        if (match !== null) {
          return { reason, heuristic: true, matchedText: snippetAround(text, match) }
        }
      }
    }
  }
  return null
}
