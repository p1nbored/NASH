import { isEnglishText } from '../../../../../../shared/english-text'
import { splitVerbatimSpans } from '../../../../../../shared/verbatim-spans'
import { hasSecretLikeText } from '../../../../../agent-exec-shared/secret-shapes'

export type AutopilotTextRefusal =
  | 'text_empty'
  | 'text_too_long'
  | 'control_characters'
  | 'secret_shaped'
  | 'too_many_quoted_spans'
  | 'not_english'

export type AutopilotTextCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: AutopilotTextRefusal }

// Why code points: no invisible bidi or line-separator character is spelled out in this source.
const FORBIDDEN_FORMAT_CODE_POINTS: ReadonlySet<number> = new Set([
  0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069, 0x2028, 0x2029
])
const NEWLINE = 0x0a
const TAB = 0x09
const ANY_LETTER = /\p{L}/u

function hasForbiddenControl(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    const control =
      (code < 0x20 && code !== NEWLINE && code !== TAB) || (code >= 0x7f && code <= 0x9f)
    const loneSurrogate = code >= 0xd800 && code <= 0xdfff
    if (control || loneSurrogate || FORBIDDEN_FORMAT_CODE_POINTS.has(code)) {
      return true
    }
  }
  return false
}

function refused(reason: AutopilotTextRefusal): AutopilotTextCheck {
  return { ok: false, reason }
}

type TaskSpecTextRefusal = Extract<AutopilotTextRefusal, 'text_empty'>

/**
 * D-027 restrictions 6 and 8: a TaskSpec text may be in any language, of any length (the TaskSpec
 * as a whole has a byte ceiling) and hold any character; only a blank text is refused.
 */
export function checkTaskSpecText(
  text: string
): { readonly ok: true } | { readonly ok: false; readonly reason: TaskSpecTextRefusal } {
  return text.trim() === '' ? { ok: false, reason: 'text_empty' } : { ok: true }
}

/**
 * The checks a task-report or run-complete summary from the primary passes (D-013): English prose
 * with names and quotations in quoted spans of any script, no credential shape anywhere, no control
 * character but newline and tab, and the store's length in UTF-16 units. TaskSpec text and follow-up
 * messages are not checked here (checkTaskSpecText; prepareRunMessageText, D-027).
 */
export function checkAutopilotText(text: string, maxChars: number): AutopilotTextCheck {
  if (text.trim() === '') {
    return refused('text_empty')
  }
  if (text.length > maxChars) {
    return refused('text_too_long')
  }
  if (hasForbiddenControl(text)) {
    return refused('control_characters')
  }
  if (hasSecretLikeText(text)) {
    return refused('secret_shaped')
  }
  const split = splitVerbatimSpans(text)
  if (!split.ok) {
    return refused('too_many_quoted_spans')
  }
  if (!isEnglishText(split.prose) || !ANY_LETTER.test(split.outsideSpans)) {
    return refused('not_english')
  }
  return { ok: true }
}
