import { splitVerbatimSpans, VERBATIM_SPAN_PLACEHOLDER } from '../../../shared/verbatim-spans'
import { DOT_VALIDATION_TITLE_MAX_CHARS } from '../../../shared/dot-ingress/dot-ingress-validation'
import { neutralizeDisplayControls } from '../../../shared/display-control-characters'
import { hasSecretLikeText } from '../../agent-exec-shared/secret-shapes'
import { scanClefText } from '../../clef/clef-content-scan'
import { redactPermissionLine } from '../permission-relay/permission-redaction'

// G7: the only free text dot sees of a validation decision (title and summary, user decision "Title,
// reason, summary"). The shared display rule first turns controls, bidi embeddings, isolates and
// line separators into spaces. Clef's span masking hides quoted names and paths; every other token
// that holds a slash or backslash is a path and is replaced, as the remote event lines do; e-mail
// addresses and long hex ids, which Clef's scan flags, are replaced too. NASH's credential masking
// and one-line folding (any other format character) follow, then Clef's content scan and the
// credential check decide: a line either still flags is withheld, never partly sent.

export const DOT_VALIDATION_TITLE_FALLBACK = 'Untitled task'
export const DOT_PATH_MASK = '[path]'
const EMAIL_MASK = '[email]'
const HEX_ID_MASK = '[id]'
/** Room past the shown line, so masking that shortens the text still has text to show. */
const SCAN_WINDOW_FACTOR = 4

const MASK_EVERY_SPAN = { maxSpans: Number.POSITIVE_INFINITY }
const PATH_TOKEN = /\S*[\\/]\S*/g
const EMAIL = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const HEX_ID = /[0-9A-Fa-f]{32,}/g

export type DotSafeLine =
  | { readonly line: string; readonly withheld: false }
  | { readonly line: null; readonly withheld: boolean }

const NOTHING: DotSafeLine = { line: null, withheld: false }
const WITHHELD: DotSafeLine = { line: null, withheld: true }

// Why drop the last token of a cut window: a credential cut in half no longer matches its shape.
function scanWindow(text: string, maxChars: number): string {
  const limit = maxChars * SCAN_WINDOW_FACTOR
  if (text.length <= limit) {
    return text
  }
  const head = text.slice(0, limit)
  const lastSpace = head.search(/\s\S*$/)
  return lastSpace > 0 ? head.slice(0, lastSpace) : ''
}

function maskNamesAndPaths(text: string): string {
  const split = splitVerbatimSpans(text, MASK_EVERY_SPAN)
  // Why: with no span limit the split cannot fail; if it ever did, none of the text is kept.
  const prose = split.ok ? split.prose : VERBATIM_SPAN_PLACEHOLDER
  return prose
    .replace(PATH_TOKEN, DOT_PATH_MASK)
    .replace(EMAIL, EMAIL_MASK)
    .replace(HEX_ID, HEX_ID_MASK)
}

function stillFlagged(line: string): boolean {
  return scanClefText(line).length > 0 || hasSecretLikeText(line)
}

/** One masked line of at most `maxChars` code points, or null: nothing to show, or withheld. */
export function dotSafeLine(text: string | null, maxChars: number): DotSafeLine {
  if (text === null || text.trim() === '') {
    return NOTHING
  }
  const masked = maskNamesAndPaths(neutralizeDisplayControls(scanWindow(text, maxChars)))
  const folded = redactPermissionLine(masked, maxChars)
  if (folded === null) {
    return masked.trim() === '' ? NOTHING : WITHHELD
  }
  return stillFlagged(folded.text) ? WITHHELD : { line: folded.text, withheld: false }
}

/** The title dot sees: the masked line, or a fixed English title when nothing safe remains. */
export function dotValidationTitle(text: string | null): string {
  return dotSafeLine(text, DOT_VALIDATION_TITLE_MAX_CHARS).line ?? DOT_VALIDATION_TITLE_FALLBACK
}
