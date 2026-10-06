/**
 * D-013 verbatim spans: names, paths and quotations that must not be translated may appear inside
 * an English requirement as quoted spans in any script. They are stored and handed to agents
 * unchanged and are replaced by a neutral placeholder before anything reaches Clef.
 */

export const VERBATIM_SPAN_PLACEHOLDER = '[quoted text]'
/** Measured on the whole span, delimiters included; a longer pair stays prose. */
export const VERBATIM_SPAN_MAX_CHARS = 1_000
export const VERBATIM_SPAN_MAX_COUNT = 32

export type VerbatimSpanKind = 'double_quote' | 'typographic_quote' | 'backtick' | 'fence'

export type VerbatimSpan = Readonly<{
  kind: VerbatimSpanKind
  /** The exact source bytes, delimiters included. */
  raw: string
  /** The exact source bytes between the delimiters. */
  content: string
  /** UTF-16 offsets of `raw` in the source text. */
  start: number
  end: number
}>

export type VerbatimSplit =
  | Readonly<{
      ok: true
      /** The text with each span replaced by the placeholder; nothing else is rewritten. */
      prose: string
      /** The text between the spans, joined by single spaces and with no placeholders. */
      outsideSpans: string
      spans: readonly VerbatimSpan[]
    }>
  | Readonly<{ ok: false; reason: 'too_many_spans' }>

type Delimiter = Readonly<{ kind: VerbatimSpanKind; open: string; close: string }>

const FENCE: Delimiter = { kind: 'fence', open: '```', close: '```' }
const BACKTICK: Delimiter = { kind: 'backtick', open: '`', close: '`' }
const DOUBLE_QUOTE: Delimiter = { kind: 'double_quote', open: '"', close: '"' }
// Why no single typographic quotes: they are English apostrophes and closing quotes.
const TYPOGRAPHIC_QUOTE: Delimiter = { kind: 'typographic_quote', open: '“', close: '”' }

const OPENER_CHARACTERS = /[`"“]/g

type SpanAttempt =
  | Readonly<{ kind: 'span'; closerIndex: number }>
  | Readonly<{ kind: 'prose'; next: number }>

function delimiterAt(text: string, index: number): Delimiter {
  switch (text[index]) {
    case '`':
      return text.startsWith(FENCE.open, index) ? FENCE : BACKTICK
    case '"':
      return DOUBLE_QUOTE
    default:
      return TYPOGRAPHIC_QUOTE
  }
}

/**
 * Pairs an opener with the next closer of its family: no nesting, no escapes. Anything that is not
 * a usable pair is consumed as prose so later quotes keep pairing left to right.
 */
function attemptSpan(
  text: string,
  start: number,
  delimiter: Delimiter,
  closersGone: Set<Delimiter>
): SpanAttempt {
  const afterOpener = start + delimiter.open.length
  // Why: once no closer remains after one opener, none remains after any later one.
  const closerIndex = closersGone.has(delimiter) ? -1 : text.indexOf(delimiter.close, afterOpener)
  if (closerIndex === -1) {
    closersGone.add(delimiter)
    return { kind: 'prose', next: afterOpener }
  }
  const end = closerIndex + delimiter.close.length
  const isEmpty = closerIndex === afterOpener
  return isEmpty || end - start > VERBATIM_SPAN_MAX_CHARS
    ? { kind: 'prose', next: end }
    : { kind: 'span', closerIndex }
}

/**
 * Linear-time scan; spans keep their raw bytes and the prose is never normalized or trimmed.
 * `maxSpans` lifts the count only: Clef masks every span of an unbounded TaskSpec (D-027).
 */
export function splitVerbatimSpans(
  text: string,
  options: { readonly maxSpans?: number } = {}
): VerbatimSplit {
  const maxSpans = options.maxSpans ?? VERBATIM_SPAN_MAX_COUNT
  const spans: VerbatimSpan[] = []
  const proseParts: string[] = []
  const outsideParts: string[] = []
  const closersGone = new Set<Delimiter>()
  let proseStart = 0
  let cursor = 0
  while (cursor < text.length) {
    OPENER_CHARACTERS.lastIndex = cursor
    const opener = OPENER_CHARACTERS.exec(text)
    if (opener === null) {
      break
    }
    const start = opener.index
    const delimiter = delimiterAt(text, start)
    const attempt = attemptSpan(text, start, delimiter, closersGone)
    if (attempt.kind === 'prose') {
      cursor = attempt.next
      continue
    }
    if (spans.length >= maxSpans) {
      return { ok: false, reason: 'too_many_spans' }
    }
    const end = attempt.closerIndex + delimiter.close.length
    spans.push({
      kind: delimiter.kind,
      raw: text.slice(start, end),
      content: text.slice(start + delimiter.open.length, attempt.closerIndex),
      start,
      end
    })
    proseParts.push(text.slice(proseStart, start), VERBATIM_SPAN_PLACEHOLDER)
    outsideParts.push(text.slice(proseStart, start))
    proseStart = end
    cursor = end
  }
  proseParts.push(text.slice(proseStart))
  outsideParts.push(text.slice(proseStart))
  return { ok: true, prose: proseParts.join(''), outsideSpans: outsideParts.join(' '), spans }
}
