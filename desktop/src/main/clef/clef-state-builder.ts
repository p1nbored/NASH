import type { RouteBlocker } from '../../shared/clef/clef-route-contract'
import { VERBATIM_SPAN_PLACEHOLDER, splitVerbatimSpans } from '../../shared/verbatim-spans'

/** Data class of an agent-written TaskSpec (D-016): inherited from the run, never lowered, the only class sent. */
export const CLEF_STATE_DATA_CLASS = 'agent_task_spec'
export const CLEF_OBJECTIVE_MAX_CHARS = 2_000
// Provisional bundle caps for the TaskSpec list fields.
export const CLEF_STATE_LIST_MAX_ITEMS = 16
export const CLEF_STATE_LIST_ITEM_MAX_CHARS = 500
/** D-027: a field cut to its cap ends with this marker, so Clef knows it classifies an excerpt. */
export const CLEF_TRUNCATION_MARKER = '[truncated]'
/**
 * A TaskSpec is at most 256 KiB of UTF-8 (D-027), which never decodes to more UTF-16 units than
 * this; it only bounds the scan of input that did not come through the TaskSpec ceiling.
 */
export const CLEF_RAW_INTAKE_MAX_CHARS = 256 * 1024

/** How much of each field the state carries; the request builder lowers them to fit its body budget. */
export type ClefStateCaps = {
  readonly objectiveChars: number
  readonly listItems: number
  readonly listItemChars: number
}

export const CLEF_STATE_CAPS: ClefStateCaps = {
  objectiveChars: CLEF_OBJECTIVE_MAX_CHARS,
  listItems: CLEF_STATE_LIST_MAX_ITEMS,
  listItemChars: CLEF_STATE_LIST_ITEM_MAX_CHARS
}

/** The TaskSpec fields Clef may see; the deliverable language never enters the state. */
export type ClefStateInput = {
  readonly objective: string
  readonly expectedOutputs?: readonly string[]
  readonly acceptanceCriteria?: readonly string[]
  readonly explicitConstraints?: readonly string[]
}

/** The Clef `state`: labeled TaskSpec text in any language, verbatim spans as placeholders; no capability descriptions. */
export type ClefState = {
  readonly objective: string
  readonly expected_outputs?: readonly string[]
  readonly acceptance_criteria?: readonly string[]
  readonly explicit_constraints?: readonly string[]
  readonly data_class: typeof CLEF_STATE_DATA_CLASS
}

export type ClefStateResult =
  | { readonly ok: true; readonly state: ClefState }
  | { readonly ok: false; readonly blocker: RouteBlocker }

const BLANK_OBJECTIVE: RouteBlocker = { reason: 'missing_inputs', detail: 'needs_clarification' }
const ANY_LETTER = /\p{L}/u
// D-027: every span is masked however many there are, with the same pairing rules (restriction 10).
const MASK_EVERY_SPAN = { maxSpans: Number.POSITIVE_INFINITY }
const EXCERPT_SUFFIX = ` ${CLEF_TRUNCATION_MARKER}`

function intakeStrings(input: ClefStateInput): string[] {
  return [
    input.objective,
    ...(input.expectedOutputs ?? []),
    ...(input.acceptanceCriteria ?? []),
    ...(input.explicitConstraints ?? [])
  ]
}

/** Bounds scan cost on raw intake: the TaskSpec as a whole, never a per-field cap (D-027). */
export function isWithinRawIntakeBounds(input: ClefStateInput): boolean {
  let total = 0
  for (const text of intakeStrings(input)) {
    total += text.length
    if (total > CLEF_RAW_INTAKE_MAX_CHARS) {
      return false
    }
  }
  return true
}

function normalizeStateText(text: string): string {
  return text.normalize('NFC').replace(/\r\n?/g, '\n').trim()
}

type MaskedText = { readonly prose: string; readonly hasLetterOutsideSpans: boolean }

/** D-013: spans become placeholders before any cap or scan, so Clef never sees a name or path. */
function maskSpans(text: string): MaskedText {
  const split = splitVerbatimSpans(text, MASK_EVERY_SPAN)
  // Why: with no span limit the split cannot fail; if it ever did, none of the text is sent.
  return split.ok
    ? { prose: split.prose, hasLetterOutsideSpans: ANY_LETTER.test(split.outsideSpans) }
    : { prose: VERBATIM_SPAN_PLACEHOLDER, hasLetterOutsideSpans: false }
}

/** The intake strings as Clef would see them, for the raw scan of the whole TaskSpec. */
export function maskedIntakeStrings(input: ClefStateInput): string[] {
  return intakeStrings(input).map((text) => maskSpans(text).prose)
}

/**
 * The masked text cut to `maxChars` and ending in the truncation marker (D-027, F1 item 1). The cut
 * never splits a surrogate pair or a placeholder; the whole text was content-scanned before this.
 */
export function clefExcerpt(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text
  }
  let cut = Math.max(0, maxChars - EXCERPT_SUFFIX.length)
  const lastUnit = text.charCodeAt(cut - 1)
  if (cut > 0 && lastUnit >= 0xd800 && lastUnit <= 0xdbff) {
    cut -= 1
  }
  const placeholder = text.lastIndexOf(VERBATIM_SPAN_PLACEHOLDER, cut - 1)
  if (placeholder !== -1 && placeholder + VERBATIM_SPAN_PLACEHOLDER.length > cut) {
    cut = placeholder
  }
  return `${text.slice(0, cut).trimEnd()}${EXCERPT_SUFFIX}`
}

/** Each item masked and cut; a list past its cap keeps its head and ends with how many items were left out. */
function stateList(items: readonly string[] | undefined, caps: ClefStateCaps): string[] | null {
  const masked = (items ?? [])
    .map(normalizeStateText)
    .filter((item) => item.length > 0)
    .map((item) => clefExcerpt(maskSpans(item).prose, caps.listItemChars))
  if (masked.length === 0) {
    return null
  }
  if (masked.length <= caps.listItems) {
    return masked
  }
  const kept = masked.slice(0, Math.max(0, caps.listItems - 1))
  return [...kept, `[truncated: ${masked.length - kept.length} more items]`]
}

/**
 * Deterministic state in the TaskSpec's own language (D-027): spans masked, each field cut to its cap
 * with an explicit marker. Only an objective with nothing to classify outside its spans is blocked.
 */
export function buildClefState(
  input: ClefStateInput,
  caps: ClefStateCaps = CLEF_STATE_CAPS
): ClefStateResult {
  const objective = normalizeStateText(input.objective)
  if (objective.length === 0) {
    return { ok: false, blocker: BLANK_OBJECTIVE }
  }
  const masked = maskSpans(objective)
  if (!masked.hasLetterOutsideSpans) {
    return { ok: false, blocker: BLANK_OBJECTIVE }
  }
  const outputs = stateList(input.expectedOutputs, caps)
  const criteria = stateList(input.acceptanceCriteria, caps)
  const constraints = stateList(input.explicitConstraints, caps)
  return {
    ok: true,
    state: {
      objective: clefExcerpt(masked.prose, caps.objectiveChars),
      ...(outputs ? { expected_outputs: outputs } : {}),
      ...(criteria ? { acceptance_criteria: criteria } : {}),
      ...(constraints ? { explicit_constraints: constraints } : {}),
      data_class: CLEF_STATE_DATA_CLASS
    }
  }
}

/** Every string the state would send, in key order. */
export function clefStateStrings(state: ClefState): string[] {
  return [
    state.objective,
    ...(state.expected_outputs ?? []),
    ...(state.acceptance_criteria ?? []),
    ...(state.explicit_constraints ?? []),
    state.data_class
  ]
}
