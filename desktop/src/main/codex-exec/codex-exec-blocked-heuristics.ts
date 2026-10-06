import { boundText, redactSecretLikeText } from '../agent-exec-shared/secret-redaction'

// HEURISTIC: the CLI documents no error code for quota or auth, so text decides, and only on a run that already failed.

export type CodexExecBlockMatch = {
  readonly reason: 'quota' | 'auth'
  readonly heuristic: true
  readonly matchedText: string
}

const QUOTA_PATTERNS: readonly RegExp[] = [
  /usage limit/i,
  /insufficient[_ ]quota/i,
  /exceeded your (?:current )?quota/i,
  /quota (?:exceeded|exhausted|reached)/i,
  /(?:reached|hit) your (?:\w+ )?(?:limit|quota)/i,
  /out of (?:credits|usage)/i
]

const AUTH_PATTERNS: readonly RegExp[] = [
  /not (?:logged|signed) in/i,
  /please (?:log|sign) ?in/i,
  /\bunauthori[sz]ed\b/i,
  /authentication (?:failed|required|error)/i,
  /refresh token (?:was |has )?(?:expired|revoked|reused|invalid)/i,
  /could not be refreshed/i,
  /codex login/i,
  /invalid[_ ](?:api[_ ]key|credentials|token)/i,
  /token_expired/i
]

const CONTEXT_CHARS = 80
const MAX_MATCHED_CHARS = 240

function snippetAround(text: string, match: RegExpExecArray): string {
  const start = Math.max(0, match.index - CONTEXT_CHARS)
  const end = Math.min(text.length, match.index + match[0].length + CONTEXT_CHARS)
  return boundText(text.slice(start, end).trim(), MAX_MATCHED_CHARS).text
}

/** Find quota or auth text in failure messages and stderr only; agent output must never be passed in. */
export function detectCodexExecBlock(texts: readonly string[]): CodexExecBlockMatch | null {
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
