import type { RouteBlocker } from '../../shared/clef/clef-route-contract'
import { redactString } from '../observability/redactor'

export const CLEF_CONTENT_RULE_NAMES = [
  'cloudflare_token',
  'hex_identifier',
  'bearer_token',
  'jwt',
  'private_key',
  'email_address',
  'windows_absolute_path',
  'posix_absolute_path',
  'file_url',
  'url_userinfo'
] as const
export type ClefContentRuleName = (typeof CLEF_CONTENT_RULE_NAMES)[number]

// 32+ token characters with a digit and an uppercase letter, the shape of Cloudflare API tokens.
const MIXED_TOKEN_RUN =
  /(?<![A-Za-z0-9_-])(?=[A-Za-z0-9_-]*[0-9])(?=[A-Za-z0-9_-]*[A-Z])[A-Za-z0-9_-]{32,}/
// Cloudflare API tokens are 40 characters; random ones may lack a digit or an uppercase letter.
const TOKEN_LENGTH_RUN = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{40}(?![A-Za-z0-9_-])/g
const TOKEN_CHARACTER_CLASSES = [/[A-Z]/, /[a-z]/, /[0-9]/] as const
const MIN_TOKEN_CHARACTER_CLASSES = 2

function hasTokenShapedRun(text: string): boolean {
  if (MIXED_TOKEN_RUN.test(text)) {
    return true
  }
  return [...text.matchAll(TOKEN_LENGTH_RUN)].some(
    ([run]) =>
      TOKEN_CHARACTER_CLASSES.filter((characterClass) => characterClass.test(run)).length >=
      MIN_TOKEN_CHARACTER_CLASSES
  )
}

function matching(pattern: RegExp): (text: string) => boolean {
  return (text) => pattern.test(text)
}

// Why: unbounded rules anchor on a run start (lookbehind or literal prefix) so long inputs stay linear.
const CONTENT_RULES: Readonly<Record<ClefContentRuleName, (text: string) => boolean>> =
  Object.freeze({
    cloudflare_token: hasTokenShapedRun,
    // Account ids are 32 hex digits, glued to other text or not; longer runs are hashes, also local-only.
    hex_identifier: matching(/[0-9A-Fa-f]{32}/),
    bearer_token: matching(/\bbearer\s+(?=[A-Za-z0-9._~+/=-]*[0-9])[A-Za-z0-9._~+/=-]{8,}/i),
    jwt: matching(/\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/),
    // The header alone is enough: a pasted key may be truncated before its END line.
    private_key: matching(
      /-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY[A-Z ]{0,20}-----|PuTTY-User-Key-File-\d/
    ),
    email_address: matching(/(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/),
    windows_absolute_path: matching(/(?<![A-Za-z0-9])[A-Za-z]:[\\/]|\\\\[A-Za-z0-9._$-]+\\/),
    // Two segments (or `~/`) so slash commands like `/review` and `and/or` pass.
    posix_absolute_path: matching(/(?:^|[\s"'(<[=,`])(?:~\/[A-Za-z0-9._-]+|\/[A-Za-z0-9._-]+\/)/),
    file_url: matching(/(?<![A-Za-z0-9+.-])file:\/\//i),
    url_userinfo: matching(/(?<![A-Za-z0-9+.-])[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s/@]+@/)
  })

const REDACTOR_TAG = /\[redacted:([a-z0-9-]+)\]/g
const REDACTOR_USERINFO_MARK = '[redacted]@'

export type ClefContentScanResult =
  | { readonly clean: true }
  | {
      readonly clean: false
      /** Rule names only; matched text and positions are never kept. */
      readonly matchedRules: readonly string[]
      readonly blocker: RouteBlocker
    }

const DATA_BOUNDARY_BLOCKER: RouteBlocker = {
  reason: 'classifier_unavailable',
  detail: 'data_boundary_forbids'
}

function redactorTagCounts(text: string): ReadonlyMap<string, number> {
  const tags = [...text.matchAll(REDACTOR_TAG)].map((match) => match[1] ?? '')
  const userinfoMarks = text.split(REDACTOR_USERINFO_MARK).length - 1
  const counts = new Map<string, number>()
  for (const tag of tags) {
    counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  if (userinfoMarks > 0) {
    counts.set('url-userinfo', userinfoMarks)
  }
  return counts
}

/** Names the observability redactor rules that fire, read from the tags they leave behind. */
function redactorRuleNames(text: string): string[] {
  const redacted = redactString(text)
  if (redacted === text) {
    return []
  }
  const before = redactorTagCounts(text)
  const fired = [...redactorTagCounts(redacted)]
    .filter(([tag, count]) => count > (before.get(tag) ?? 0))
    .map(([tag]) => `redactor:${tag}`)
  return fired.length > 0 ? fired : ['redactor:unclassified']
}

function ownRuleNames(text: string): ClefContentRuleName[] {
  return CLEF_CONTENT_RULE_NAMES.filter((name) => CONTENT_RULES[name](text))
}

/** Matched rule names for one string, sorted; NFKC also catches fullwidth look-alikes. */
export function scanClefText(text: string): string[] {
  const variants = [...new Set([text, text.normalize('NFKC')])]
  const names = new Set(
    variants.flatMap((variant) => [...ownRuleNames(variant), ...redactorRuleNames(variant)])
  )
  return [...names].sort()
}

/** Scans every state string before any call; a hit blocks with no call (spec section 5). */
export function scanClefContent(texts: readonly string[]): ClefContentScanResult {
  const matchedRules = [...new Set(texts.flatMap(scanClefText))].sort()
  return matchedRules.length === 0
    ? { clean: true }
    : { clean: false, matchedRules, blocker: DATA_BOUNDARY_BLOCKER }
}
