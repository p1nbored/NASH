import { z } from 'zod'

/**
 * D-013 deliverable language: an optional BCP 47 tag that tells an agent which language to write
 * deliverables in. It is advisory; nothing in the framework rejects a deliverable for its language.
 */

export const DELIVERABLE_LANGUAGE_MAX_LENGTH = 35

// Why: Intl accepts any grammatical tag, including 5-8 letter language names and grandfathered
// forms; only a 2-3 letter language followed by short alphanumeric subtags is a usable deliverable language.
const STRUCTURAL_TAG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/

export type DeliverableLanguageResult =
  | Readonly<{ ok: true; tag: string }>
  | Readonly<{ ok: false; reason: 'invalid_language_tag' }>

const INVALID: DeliverableLanguageResult = Object.freeze({
  ok: false,
  reason: 'invalid_language_tag'
})

/** The canonical form of a well-formed tag (`zh-hant-tw` becomes `zh-Hant-TW`), or a refusal. */
export function canonicalizeDeliverableLanguage(value: unknown): DeliverableLanguageResult {
  if (
    typeof value !== 'string' ||
    value.length > DELIVERABLE_LANGUAGE_MAX_LENGTH ||
    !STRUCTURAL_TAG.test(value)
  ) {
    return INVALID
  }
  try {
    const [tag] = Intl.getCanonicalLocales(value)
    return tag === undefined ? INVALID : { ok: true, tag }
  } catch {
    // Why: RangeError is Intl's own verdict that the tag is not well formed.
    return INVALID
  }
}

/** Validates only; the wire value is never rewritten, so the service stores the canonical form. */
export const DeliverableLanguageSchema = z
  .string()
  .max(DELIVERABLE_LANGUAGE_MAX_LENGTH)
  .refine((value) => canonicalizeDeliverableLanguage(value).ok, 'Not a valid BCP 47 language tag')

/** The one English sentence that carries the language to an agent; null when none was requested. */
export function deliverableLanguageDirective(tag: string | null | undefined): string | null {
  const canonical = canonicalizeDeliverableLanguage(tag)
  return canonical.ok
    ? `Write deliverables and output files in ${canonical.tag}; report to the framework in English.`
    : null
}
