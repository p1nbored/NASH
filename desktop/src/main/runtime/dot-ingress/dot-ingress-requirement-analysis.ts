import { canonicalizeDeliverableLanguage } from '../../../shared/deliverable-language'
import {
  DOT_INGRESS_ERROR_MESSAGES,
  type DotIngressErrorCode
} from '../../../shared/dot-ingress/dot-ingress-errors'
import {
  DOT_INGRESS_PROSE_MAX_CHARS,
  DOT_INGRESS_SCAN_RULE_MAX_COUNT
} from '../../../shared/dot-ingress/dot-ingress-limits'
import { isEnglishText } from '../../../shared/english-text'
import { splitVerbatimSpans } from '../../../shared/verbatim-spans'
import { hasSecretLikeText } from '../../agent-exec-shared/secret-shapes'
import { scanClefText } from '../../clef/clef-content-scan'
import { OrchestrationError } from '../orchestration/orchestration-error'

// The checks a dot requirement passes before anything is stored (D-013, D-018): English prose, with
// names, paths and quotations in quoted spans. A credential is refused anywhere; any other content
// rule is refused in prose and only recorded, by rule name, inside a span. Pure: no I/O.

/** Rules whose match is a credential; `redactor:*` names come from the observability secret scrubber. */
const SECRET_RULES: ReadonlySet<string> = new Set([
  'cloudflare_token',
  'bearer_token',
  'jwt',
  'private_key',
  'url_userinfo'
])
const ANY_LETTER = /\p{L}/u

export type DotRequirementAnalysis = {
  /** Content rules matched inside quoted spans, by name only. */
  readonly scanRules: readonly string[]
  /** The canonical BCP 47 tag, or null when none was requested. */
  readonly deliverableLanguage: string | null
}

function isSecretRule(rule: string): boolean {
  return SECRET_RULES.has(rule) || rule.startsWith('redactor:')
}

/** The contract's fixed English message; data names rules only, never matched text. */
function refused(
  code: DotIngressErrorCode,
  data?: { rules: readonly string[] }
): OrchestrationError {
  return new OrchestrationError(code, DOT_INGRESS_ERROR_MESSAGES[code], data)
}

function requireNoSecret(text: string): void {
  const secretRules = scanClefText(text).filter(isSecretRule)
  if (secretRules.length > 0 || hasSecretLikeText(text)) {
    throw refused('dot_requirement_rejected_content', {
      rules: secretRules.length > 0 ? secretRules : ['secret_shape']
    })
  }
}

function canonicalLanguage(tag: string | null | undefined): string | null {
  if (tag === undefined || tag === null) {
    return null
  }
  const canonical = canonicalizeDeliverableLanguage(tag)
  if (!canonical.ok) {
    throw refused('dot_deliverable_language_invalid')
  }
  return canonical.tag
}

/** Throws the dot error the requirement fails first; a credential is checked before anything else. */
export function analyzeDotRequirement(input: {
  objective: string
  deliverableLanguage?: string | null
}): DotRequirementAnalysis {
  const text = input.objective.normalize('NFC').replace(/\r\n?/g, '\n')
  requireNoSecret(text)
  if (text.trim() === '') {
    throw refused('dot_requirement_unclear')
  }
  const split = splitVerbatimSpans(text)
  if (!split.ok) {
    throw refused('dot_requirement_too_long')
  }
  if (!isEnglishText(split.prose)) {
    throw refused('dot_requirement_not_english')
  }
  if (!ANY_LETTER.test(split.outsideSpans)) {
    throw refused('dot_requirement_unclear')
  }
  if (split.prose.trim().length > DOT_INGRESS_PROSE_MAX_CHARS) {
    throw refused('dot_requirement_too_long')
  }
  const proseRules = scanClefText(split.prose)
  if (proseRules.length > 0) {
    throw refused('dot_requirement_rejected_content', { rules: proseRules })
  }
  const spanRules = [...new Set(split.spans.flatMap((span) => scanClefText(span.content)))].sort()
  return {
    scanRules: spanRules.slice(0, DOT_INGRESS_SCAN_RULE_MAX_COUNT),
    deliverableLanguage: canonicalLanguage(input.deliverableLanguage)
  }
}
