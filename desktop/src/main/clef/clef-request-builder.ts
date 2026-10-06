import { createHash } from 'node:crypto'
import type { RouteBlocker } from '../../shared/clef/clef-route-contract'
import { scanClefContent } from './clef-content-scan'
import { buildClassifierQuestions, type ClefClassifierQuestions } from './clef-question-set'
import {
  CLEF_MAX_BODY_BYTES,
  CLEF_MAX_ESTIMATED_INPUT_TOKENS,
  estimateClefInputTokens,
  preflightClefRequest
} from './clef-request-builder-preflight'
import {
  CLEF_STATE_CAPS,
  buildClefState,
  clefStateStrings,
  isWithinRawIntakeBounds,
  maskedIntakeStrings,
  type ClefState,
  type ClefStateCaps,
  type ClefStateInput
} from './clef-state-builder'
import { clefCanonicalSha256 } from './clef-verified-profile'

/** Body model pinned to `clef`; `clef-flash` and whitespace variants are never sent (R02). */
export const CLEF_BODY_MODEL = 'clef'

/** Never `images`, never `options` (spec section 5); only the two classifier questions. */
export type ClefRequestBody = {
  readonly model: typeof CLEF_BODY_MODEL
  readonly state: ClefState
  readonly questions: ClefClassifierQuestions
}

export type BuiltClefRequest = {
  readonly body: ClefRequestBody
  /** Exact bytes to send; kept locally with their hash, which is never sent. */
  readonly bodyBytes: Uint8Array
  readonly bodySha256: string
  /** Canonical-JSON SHA-256 of the state, for the decision record and cache fingerprint. */
  readonly stateSha256: string
  readonly estimatedInputTokens: number
}

export type ClefRequestBuildResult =
  | { readonly ok: true; readonly request: BuiltClefRequest }
  | {
      readonly ok: false
      readonly blocker: RouteBlocker
      /** Content-scan rule names when the data boundary blocked; otherwise empty. */
      readonly matchedRules: readonly string[]
    }

const REQUEST_REJECTED: RouteBlocker = {
  reason: 'classifier_unavailable',
  detail: 'request_rejected'
}

type ClefIntakeBlock = Extract<ClefRequestBuildResult, { ok: false }>

function rejected(blocker: RouteBlocker): ClefIntakeBlock {
  return { ok: false, blocker, matchedRules: [] }
}

/** The intake checks shared by the G1 data-boundary gate and the request builder. */
export type ClefIntakeCheck = { readonly ok: true; readonly state: ClefState } | ClefIntakeBlock

function scanBlock(texts: readonly string[]): ClefIntakeBlock | null {
  const scan = scanClefContent(texts)
  return scan.clean ? null : { ok: false, blocker: scan.blocker, matchedRules: scan.matchedRules }
}

/**
 * Raw bound, content scan of the whole masked TaskSpec, the state cut to its caps, state scan. D-013
 * spans are masked before any scan, so only the prose Clef would see is ever scanned. Scanning the
 * whole text first means a cut can never hide a secret that straddles it (D-027).
 */
export function checkClefIntake(
  intake: ClefStateInput,
  caps: ClefStateCaps = CLEF_STATE_CAPS
): ClefIntakeCheck {
  if (!isWithinRawIntakeBounds(intake)) {
    return rejected(REQUEST_REJECTED)
  }
  const rawScanBlock = scanBlock(maskedIntakeStrings(intake))
  if (rawScanBlock) {
    return rawScanBlock
  }
  const built = buildClefState(intake, caps)
  if (!built.ok) {
    return rejected(built.blocker)
  }
  // Why: the spec scans every state string; normalization may differ from the raw text.
  return scanBlock(clefStateStrings(built.state)) ?? { ok: true, state: built.state }
}

/** Each step halves the caps; the last is small enough that any TaskSpec fits the body and estimate caps. */
const CAP_STEPS: readonly ClefStateCaps[] = [1, 2, 4, 8].map((divisor) => ({
  objectiveChars: Math.floor(CLEF_STATE_CAPS.objectiveChars / divisor),
  listItems: CLEF_STATE_CAPS.listItems,
  listItemChars: Math.floor(CLEF_STATE_CAPS.listItemChars / divisor)
}))

type Assembled = {
  readonly body: ClefRequestBody
  readonly bodyBytes: Uint8Array
  readonly estimatedInputTokens: number
}

function assemble(state: ClefState): Assembled {
  const body: ClefRequestBody = {
    model: CLEF_BODY_MODEL,
    state,
    questions: buildClassifierQuestions()
  }
  return {
    body,
    bodyBytes: new TextEncoder().encode(JSON.stringify(body)),
    estimatedInputTokens: estimateClefInputTokens(body.state, body.questions)
  }
}

function fitsPreflightBudget(candidate: Assembled): boolean {
  return (
    candidate.bodyBytes.byteLength <= CLEF_MAX_BODY_BYTES &&
    candidate.estimatedInputTokens <= CLEF_MAX_ESTIMATED_INPUT_TOKENS
  )
}

/**
 * The first excerpt of the TaskSpec that fits the body and estimate caps (D-027): a TaskSpec over
 * Clef's caps, or in a script that takes more bytes, is classified from a shorter excerpt.
 */
function assembleWithinBudget(taskSpec: ClefStateInput): ClefIntakeBlock | Assembled {
  let candidate: Assembled | null = null
  for (const caps of CAP_STEPS) {
    const intake = checkClefIntake(taskSpec, caps)
    if (!intake.ok) {
      return intake
    }
    candidate = assemble(intake.state)
    if (fitsPreflightBudget(candidate)) {
      return candidate
    }
  }
  return candidate ?? rejected(REQUEST_REJECTED)
}

/** Section 5 pipeline: TaskSpec checks, then the two classifier questions and preflight. */
export function buildClefRequest(taskSpec: ClefStateInput): ClefRequestBuildResult {
  const assembled = assembleWithinBudget(taskSpec)
  if ('ok' in assembled) {
    return assembled
  }
  const { body, bodyBytes, estimatedInputTokens } = assembled
  const preflightBlocker = preflightClefRequest({
    questions: body.questions,
    bodyByteLength: bodyBytes.byteLength,
    estimatedInputTokens
  })
  if (preflightBlocker) {
    return rejected(preflightBlocker)
  }
  return {
    ok: true,
    request: {
      body,
      bodyBytes,
      bodySha256: createHash('sha256').update(bodyBytes).digest('hex'),
      stateSha256: clefCanonicalSha256(body.state),
      estimatedInputTokens
    }
  }
}
