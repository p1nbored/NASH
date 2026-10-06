import { hasSecretLikeText, maskSecretLikeText } from './secret-shapes'

// Everything the runner keeps from a child's text goes through here: the CLI echoes bad credentials.

/** Text past this is dropped before redaction, so one huge line cannot cost more than a bounded scan. */
export const MAX_REDACTION_INPUT_CHARS = 256 * 1024
/** Extra text redacted past the output bound, so a secret straddling the cut is seen whole. */
const REDACTION_MARGIN_CHARS = 512

/** Mask credential-shaped substrings in at most the first 256K characters. */
export function redactSecretLikeText(text: string): string {
  return maskSecretLikeText(
    text.length > MAX_REDACTION_INPUT_CHARS ? text.slice(0, MAX_REDACTION_INPUT_CHARS) : text
  )
}

/** True when the text contains a credential shape anywhere; linear, so safe on a 4 MiB message. */
export function containsSecretLikeText(text: string): boolean {
  return hasSecretLikeText(text)
}

export type BoundedText = { readonly text: string; readonly truncated: boolean }

/** Cut to at most `maxChars` UTF-16 units without leaving half a surrogate pair. */
export function boundText(text: string, maxChars: number): BoundedText {
  if (text.length <= maxChars) {
    return { text, truncated: false }
  }
  const lastUnit = text.charCodeAt(maxChars - 1)
  const splitsPair = lastUnit >= 0xd800 && lastUnit <= 0xdbff
  return { text: text.slice(0, splitsPair ? maxChars - 1 : maxChars), truncated: true }
}

/** Clip to the bound plus a margin, redact, then bound again: cost never depends on input length. */
export function redactAndBound(text: string, maxChars: number): BoundedText {
  const windowChars = Math.min(maxChars + REDACTION_MARGIN_CHARS, MAX_REDACTION_INPUT_CHARS)
  const clipped = text.length > windowChars
  const bounded = boundText(
    redactSecretLikeText(clipped ? text.slice(0, windowChars) : text),
    maxChars
  )
  return { text: bounded.text, truncated: bounded.truncated || clipped }
}
