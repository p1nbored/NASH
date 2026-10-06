// Credential shapes shared by redaction and the last-message scan; every pattern is linear on any input.

const MASK = '[redacted]'

type CredentialPattern = { readonly pattern: RegExp; readonly replacement: string }

// Not Orca's redactors: the crash-report patterns are private, and its credential-URL and the observability JWT shape are quadratic.
const CREDENTIAL_PATTERNS: readonly CredentialPattern[] = [
  {
    pattern:
      /-----BEGIN [A-Z ]*PRIVATE KEY-----(?:[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----|[\s\S]*)/g,
    replacement: MASK
  },
  { pattern: /(?<![A-Za-z0-9_])sk-[A-Za-z0-9_-]{16,}/g, replacement: MASK },
  { pattern: /(?<![A-Za-z0-9_])gh[pousr]_[A-Za-z0-9_]{20,}/g, replacement: MASK },
  { pattern: /(?<![A-Za-z0-9_])github_pat_[A-Za-z0-9_]{20,}/g, replacement: MASK },
  { pattern: /(?<![A-Za-z0-9_])glpat-[A-Za-z0-9_-]{20,}/g, replacement: MASK },
  { pattern: /(?<![A-Za-z0-9_])xox[baprs]-[A-Za-z0-9-]{10,}/g, replacement: MASK },
  { pattern: /(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}(?![A-Za-z0-9])/g, replacement: MASK },
  // Starting only at a token boundary keeps a long eyJ-eyJ-... run from being rescanned per start.
  {
    pattern: /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g,
    replacement: MASK
  },
  {
    pattern: /(?<![A-Za-z0-9_])Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
    replacement: `Bearer ${MASK}`
  },
  // Userinfo before the first slash, bounded so each `://` costs a constant.
  { pattern: /(?<=:\/\/)[^\s/@]{1,256}@/g, replacement: `${MASK}@` },
  {
    pattern:
      /((?:proxy-)?authorization["']?\s*[:=]\s*["']?(?:(?:bearer|basic|digest|negotiate|token)\s+)?)[^\s"',;]{4,}/gi,
    replacement: `$1${MASK}`
  },
  {
    pattern:
      /(?<![A-Za-z0-9_-])(--(?:password|passwd|token|secret|api-?key|access-token|auth-token|client-secret)(?:=|[ \t]+))\S+/gi,
    replacement: `$1${MASK}`
  },
  // No leading identifier group: one in front of the keyword made this quadratic.
  {
    pattern:
      /((?:api[_-]?key|_key|token|secret|password|passwd)["']?\s*[:=]\s*["']?)[^\s"',;]{4,}/gi,
    replacement: `$1${MASK}`
  }
]

/** Replace every credential-shaped span; ordinary text passes through unchanged. */
export function maskSecretLikeText(text: string): string {
  return CREDENTIAL_PATTERNS.reduce(
    (current, credential) => current.replace(credential.pattern, credential.replacement),
    text
  )
}

/** True when any credential shape occurs; `search` ignores and restores lastIndex on the shared patterns. */
export function hasSecretLikeText(text: string): boolean {
  return CREDENTIAL_PATTERNS.some((credential) => text.search(credential.pattern) !== -1)
}
