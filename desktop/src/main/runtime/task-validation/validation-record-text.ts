import { boundText } from '../../agent-exec-shared/secret-redaction'
import { hasSecretLikeText, maskSecretLikeText } from '../../agent-exec-shared/secret-shapes'
import { isEnglishText } from '../../../shared/english-text'

/** The store's bound for one check note. */
export const RECORD_NOTE_MAX_CHARS = 500
/** Text past this is cut before masking, so one huge reason costs a bounded scan. */
const MAX_INPUT_CHARS = 16 * 1024
const MAX_MASK_ROUNDS = 3
const SHARED_MASK = '[redacted]'
// Why: `token: [redacted]` still matches the keyword shape the stores refuse; three characters do not.
const RECORD_MASK = '***'

export type RecordLineOptions = {
  /** English text used when the input cannot be kept; it must itself be a valid record line. */
  readonly fallback: string
  readonly maxChars?: number
}

function singleLine(text: string): string {
  return text
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isRecordLine(text: string, maxChars: number): boolean {
  return (
    text.length > 0 &&
    text.length <= maxChars &&
    !/\p{Cc}/u.test(text) &&
    isEnglishText(text) &&
    !hasSecretLikeText(text)
  )
}

/** Masks, then bounds, until a cut no longer completes a secret shape. */
function maskedAndBounded(text: string, maxChars: number): string | null {
  let current = text
  for (let round = 0; round < MAX_MASK_ROUNDS; round += 1) {
    const masked = maskSecretLikeText(current).replaceAll(SHARED_MASK, RECORD_MASK)
    current = boundText(masked, maxChars).text.trim()
    if (!hasSecretLikeText(current)) {
      return current
    }
  }
  return null
}

/** One bounded English line with no secret shape, else the caller's fallback (direction section 19). */
export function recordLine(text: string, options: RecordLineOptions): string {
  const maxChars = options.maxChars ?? RECORD_NOTE_MAX_CHARS
  if (!isRecordLine(options.fallback, maxChars)) {
    throw new Error('The fallback record text must be one English line within the bound.')
  }
  // Why fold first: a line break between a keyword and its value hides the pair from the masks.
  const folded = singleLine(boundText(text, MAX_INPUT_CHARS).text)
  const line = maskedAndBounded(folded, maxChars)
  return line !== null && isRecordLine(line, maxChars) ? line : options.fallback
}
