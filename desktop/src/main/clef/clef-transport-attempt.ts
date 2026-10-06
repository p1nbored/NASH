import type { RouteBlocker } from '../../shared/clef/clef-route-contract'
import { cancelUnreadResponseBody } from '../lib/unread-response-body'
import type { ActiveSpan } from '../observability/tracer'
import {
  CLEF_DEADLINE_MAPPING,
  classifyClefFetchError,
  mapClefHttpStatus,
  mapClefTransportFailure,
  type ClefErrorMapping,
  type ClefLatchKind
} from './clef-error-mapping'
import { redactClefValue } from './clef-redaction'
import { readCappedBody } from './clef-transport-body'
import { fullJitterDelay, untilAborted } from './clef-transport-signals'
import type {
  ClefTransportBlocked,
  ClefTransportErrorClass,
  ClefTransportOutcome
} from './clef-transport-outcome'

export type ClefAttemptPermit = { proceed: true } | { proceed: false; blocker?: RouteBlocker }
export type ClefBeforeAttempt = (
  attemptNumber: number
) => ClefAttemptPermit | Promise<ClefAttemptPermit>

/** Everything one transport call needs; the concrete URL and header live only here. */
export type ClefAttemptContext = {
  readonly url: string
  readonly init: Omit<RequestInit, 'signal'>
  readonly secrets: readonly string[]
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>
  readonly signal: AbortSignal
  readonly callerSignal: AbortSignal | undefined
  readonly maxAttempts: number
  readonly beforeAttempt: ClefBeforeAttempt
  readonly random: () => number
  readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>
  readonly span: ActiveSpan
  /** Billed attempts so far; read by the caller's last-resort error handler. */
  readonly progress: { attempts: number }
}

type AttemptFailure = {
  mapping: ClefErrorMapping
  errorClass: Extract<
    ClefTransportErrorClass,
    'http_status' | 'network' | 'redirect_refused' | 'response_too_large'
  >
  status: number | null
}

type AttemptResult =
  | { kind: 'response'; status: number; bytes: Uint8Array }
  | { kind: 'failed'; failure: AttemptFailure }
  | { kind: 'interrupted' }

const MAX_DESCRIBED_CAUSES = 4

/** A body past the cap is not parsed or stored; like any unusable body it is never retried. */
const OVERSIZED_BODY_MAPPING: ClefErrorMapping = Object.freeze({
  retryable: false,
  blocker: Object.freeze({ reason: 'invalid_output', detail: 'response_schema_violation' })
})

export const BUDGET_EXHAUSTED_BLOCKER: RouteBlocker = Object.freeze({
  reason: 'classifier_unavailable',
  detail: 'budget_exhausted'
})

export function blockedOutcome(
  blocker: RouteBlocker,
  errorClass: ClefTransportErrorClass,
  attempts: number,
  extras: { latch?: ClefLatchKind | null; status?: number | null } = {}
): ClefTransportBlocked {
  return {
    kind: 'blocked',
    blocker: { reason: blocker.reason, detail: blocker.detail },
    latch: extras.latch ?? null,
    status: extras.status ?? null,
    errorClass,
    attempts
  }
}

function describeRedacted(value: unknown): unknown {
  if (!(value instanceof Error)) {
    return value
  }
  const parts: string[] = []
  let link: unknown = value
  for (let depth = 0; depth < MAX_DESCRIBED_CAUSES && link instanceof Error; depth++) {
    parts.push(`${link.name}: ${link.message}`)
    link = link.cause
  }
  return parts.join(' <- ')
}

/** Every error is scrubbed here, inside the span, before it becomes an event. */
export function recordRedactedError(
  span: ActiveSpan,
  eventName: string,
  error: unknown,
  secrets: readonly string[],
  attributes: Record<string, unknown> = {}
): void {
  span.addEvent(eventName, {
    ...attributes,
    error: describeRedacted(redactClefValue(error, secrets))
  })
}

async function attemptOnce(context: ClefAttemptContext, attempt: number): Promise<AttemptResult> {
  let response: Response
  try {
    response = await context.fetch(context.url, { ...context.init, signal: context.signal })
  } catch (error) {
    if (context.signal.aborted) {
      return { kind: 'interrupted' }
    }
    recordRedactedError(context.span, 'clef.attempt_failed', error, context.secrets, { attempt })
    const errorClass = classifyClefFetchError(error)
    return {
      kind: 'failed',
      failure: { mapping: mapClefTransportFailure(errorClass), errorClass, status: null }
    }
  }
  const { status } = response
  context.span.addEvent('clef.attempt_status', { attempt, status })
  const mapping = mapClefHttpStatus(status)
  if (mapping) {
    await cancelUnreadResponseBody(response)
    return { kind: 'failed', failure: { mapping, errorClass: 'http_status', status } }
  }
  try {
    const body = await readCappedBody(response)
    if (body.kind === 'oversized') {
      context.span.addEvent('clef.response_too_large', { attempt, status })
      const failure: AttemptFailure = {
        mapping: OVERSIZED_BODY_MAPPING,
        errorClass: 'response_too_large',
        status
      }
      return { kind: 'failed', failure }
    }
    return { kind: 'response', status, bytes: body.bytes }
  } catch (error) {
    await cancelUnreadResponseBody(response)
    if (context.signal.aborted) {
      return { kind: 'interrupted' }
    }
    recordRedactedError(context.span, 'clef.body_read_failed', error, context.secrets, { attempt })
    const failure: AttemptFailure = {
      mapping: mapClefTransportFailure('network'),
      errorClass: 'network',
      status
    }
    return { kind: 'failed', failure }
  }
}

const BUDGET_VETO = {
  proceed: false,
  blocker: BUDGET_EXHAUSTED_BLOCKER
} satisfies ClefAttemptPermit

function isAttemptPermit(value: unknown): value is ClefAttemptPermit {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'proceed') === 'boolean'
  )
}

type PermitAnswer = { interrupted: true } | { interrupted: false; permit: ClefAttemptPermit }

/** The hook is raced against the deadline and the caller's signal; a malformed or failed answer vetoes. */
async function askPermit(context: ClefAttemptContext, attempt: number): Promise<PermitAnswer> {
  try {
    const raced = await untilAborted(() => context.beforeAttempt(attempt), context.signal)
    if (raced.aborted) {
      return { interrupted: true }
    }
    return { interrupted: false, permit: isAttemptPermit(raced.value) ? raced.value : BUDGET_VETO }
  } catch (error) {
    recordRedactedError(context.span, 'clef.before_attempt_failed', error, context.secrets)
    return { interrupted: false, permit: BUDGET_VETO }
  }
}

/** What the deadline or the caller's cancel ends a call with, at any stage. */
export function interruptedOutcome(
  callerSignal: AbortSignal | undefined,
  attempts: number,
  lastStatus: number | null
): ClefTransportOutcome {
  if (callerSignal?.aborted) {
    return { kind: 'aborted', attempts }
  }
  return blockedOutcome(CLEF_DEADLINE_MAPPING.blocker, 'deadline', attempts, { status: lastStatus })
}

function interrupted(
  context: ClefAttemptContext,
  lastFailure: AttemptFailure | null
): ClefTransportOutcome {
  return interruptedOutcome(
    context.callerSignal,
    context.progress.attempts,
    lastFailure?.status ?? null
  )
}

function failed(failure: AttemptFailure, attempts: number): ClefTransportOutcome {
  return blockedOutcome(failure.mapping.blocker, failure.errorClass, attempts, {
    latch: failure.mapping.latch ?? null,
    status: failure.status
  })
}

/** Attempts until a response, a final failure, a veto, the deadline or a caller abort. */
export async function runClefAttempts(context: ClefAttemptContext): Promise<ClefTransportOutcome> {
  let lastFailure: AttemptFailure | null = null
  for (let attempt = 1; ; attempt++) {
    if (context.signal.aborted) {
      return interrupted(context, lastFailure)
    }
    const answer = await askPermit(context, attempt)
    if (answer.interrupted) {
      return interrupted(context, lastFailure)
    }
    const { permit } = answer
    if (!permit.proceed) {
      const blocker = permit.blocker ?? lastFailure?.mapping.blocker ?? BUDGET_EXHAUSTED_BLOCKER
      return blockedOutcome(blocker, 'vetoed', context.progress.attempts, {
        status: lastFailure?.status ?? null
      })
    }
    if (context.signal.aborted) {
      return interrupted(context, lastFailure)
    }
    context.progress.attempts = attempt
    const result = await attemptOnce(context, attempt)
    if (result.kind === 'response') {
      return { ...result, attempts: attempt }
    }
    if (result.kind === 'interrupted') {
      return interrupted(context, lastFailure)
    }
    lastFailure = result.failure
    if (!result.failure.mapping.retryable || attempt >= context.maxAttempts) {
      return failed(result.failure, attempt)
    }
    await context.sleep(fullJitterDelay(attempt, context.random), context.signal)
  }
}
