import { createHash } from 'node:crypto'
import { RUN_MESSAGE_TEXT_MAX_CHARS } from '../orchestration/db/autopilot-message-schema-definition'

const RUN_MESSAGE_TEXT_REFUSALS = ['text_empty', 'text_too_long'] as const
type RunMessageTextRefusal = (typeof RUN_MESSAGE_TEXT_REFUSALS)[number]

export type RunMessageTextPreparation =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: RunMessageTextRefusal }

const LINE_FEED = 0x0a
const TAB = 0x09
const DELETE = 0x7f
/** Control Pictures: U+2400 + n shows C0 control n, U+2421 shows DEL. */
const CONTROL_PICTURES_BASE = 0x2400
const DELETE_PICTURE = 0x2421
const REPLACEMENT_CHARACTER = 0xfffd
const LINE_ENDING = /\r\n?/g

function neutralizedCodePoint(code: number): number {
  if (code < 0x20 && code !== LINE_FEED && code !== TAB) {
    return CONTROL_PICTURES_BASE + code
  }
  if (code === DELETE) {
    return DELETE_PICTURE
  }
  const c1Control = code >= 0x80 && code <= 0x9f
  const loneSurrogate = code >= 0xd800 && code <= 0xdfff
  return c1Control || loneSurrogate ? REPLACEMENT_CHARACTER : code
}

/**
 * Why: the text is typed into a terminal inside one paste frame, which ESC (`ESC [201~`) or a C1
 * CSI could end early. Every C0 control but newline and tab, DEL and C1 become visible symbols,
 * and line endings become LF, so nothing the user wrote is refused and delivery stays whole.
 */
function neutralizeTerminalControls(text: string): string {
  let out = ''
  for (const char of text.replace(LINE_ENDING, '\n')) {
    const code = char.codePointAt(0) ?? REPLACEMENT_CHARACTER
    const typed = neutralizedCodePoint(code)
    out += typed === code ? char : String.fromCodePoint(typed)
  }
  return out
}

/**
 * Prepares a follow-up message before it is stored or typed into a primary session (D-019): any
 * language, only a technical length ceiling, no secret-shape refusal (D-027 restriction 35).
 */
export function prepareRunMessageText(text: string): RunMessageTextPreparation {
  if (text.trim() === '') {
    return { ok: false, reason: 'text_empty' }
  }
  if (Array.from(text).length > RUN_MESSAGE_TEXT_MAX_CHARS) {
    return { ok: false, reason: 'text_too_long' }
  }
  return { ok: true, text: neutralizeTerminalControls(text) }
}

/** Idempotency evidence: a replay of the same request id with other text is told apart by this. */
export function runMessageTextSha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}
