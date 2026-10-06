import { getMainHttpClient, type MainHttpClient } from '../network/http-client'
import { ensureElectronProxyFromEnvironment } from '../network/proxy-settings'
import { withSpan, type ActiveSpan } from '../observability/tracer'
import {
  CLEF_PROXY_PROBE_URL,
  CLEF_URL_TEMPLATE,
  buildClefRunUrl,
  isPinnedClefRequestBody,
  type ClefCredentialHandleLike
} from './clef-endpoint'
import {
  BUDGET_EXHAUSTED_BLOCKER,
  blockedOutcome,
  interruptedOutcome,
  recordRedactedError,
  runClefAttempts,
  type ClefBeforeAttempt
} from './clef-transport-attempt'
import type { ClefTransportOutcome } from './clef-transport-outcome'
import {
  CLEF_OVERALL_DEADLINE_MS,
  abortableSleep,
  realClefTimers,
  startClefDeadline,
  untilAborted,
  type ClefTimers
} from './clef-transport-signals'

export type { ClefAttemptPermit, ClefBeforeAttempt } from './clef-transport-attempt'

/** Billed attempts per request (D-012): a caller's remaining budget may lower this, never raise it. */
export const CLEF_DEFAULT_MAX_ATTEMPTS = 2

const BEARER_HEADER = /^Bearer [\x21-\x7E]+$/
const BEARER_PREFIX_LENGTH = 'Bearer '.length

export type ClefHttpClient = Pick<MainHttpClient, 'fetch' | 'proxySession'>

export type ClefTransportRequest = {
  credentials: ClefCredentialHandleLike
  /** Serialized request body from the request builder, sent byte for byte. */
  body: Uint8Array
  signal?: AbortSignal
  /** Remaining attempts for this request; clamped to `CLEF_DEFAULT_MAX_ATTEMPTS`, and below 1 refuses the call. */
  maxAttempts?: number
  /**
   * Required: reserves budget for each billed attempt, so no attempt is sent without the ledger.
   * A veto, a throw, a malformed answer, or a missing hook ends the call before that attempt.
   */
  beforeAttempt: ClefBeforeAttempt
}

export type ClefTransportDeps = {
  client?: ClefHttpClient
  prepareProxy?: (client: ClefHttpClient) => Promise<unknown>
  random?: () => number
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
  timers?: ClefTimers
}

type ClefWire = {
  url: string
  authorization: string
  body: Uint8Array<ArrayBuffer>
  secrets: readonly string[]
}
// Why mutable: the last-resort catch must still report attempts and scrub with live secrets.
type TransportProgress = { attempts: number; secrets: readonly string[] }
type TransportRun = {
  request: ClefTransportRequest
  deps: ClefTransportDeps
  wire: ClefWire
  span: ActiveSpan
  progress: { attempts: number }
  maxAttempts: number
}

function prepareClefProxy(client: ClefHttpClient): Promise<unknown> {
  const proxySession = client.proxySession()
  return ensureElectronProxyFromEnvironment({
    ...(proxySession ? { proxySession } : {}),
    probeUrl: CLEF_PROXY_PROBE_URL
  })
}

function readAuthorization(credentials: ClefCredentialHandleLike): string | null {
  try {
    const header: unknown = credentials.authorizationHeader()
    return typeof header === 'string' && BEARER_HEADER.test(header) ? header : null
  } catch {
    return null
  }
}

function resolveWire(
  credentials: ClefCredentialHandleLike,
  body: Uint8Array<ArrayBuffer>
): ClefWire | null {
  const target = buildClefRunUrl(credentials)
  const authorization = readAuthorization(credentials)
  if (!target.ok || authorization === null) {
    return null
  }
  return {
    url: target.url,
    authorization,
    body,
    secrets: [authorization, authorization.slice(BEARER_PREFIX_LENGTH), target.accountId]
  }
}

function annotateOutcome(span: ActiveSpan, outcome: ClefTransportOutcome): void {
  span.setAttribute('clef.outcome', outcome.kind)
  span.setAttribute('clef.attempts', outcome.attempts)
  if (outcome.kind === 'response') {
    span.setAttribute('clef.status', outcome.status)
  } else if (outcome.kind === 'blocked') {
    span.setAttribute('clef.status', outcome.status)
    span.setAttribute('clef.errorClass', outcome.errorClass)
    span.setAttribute('clef.blockerDetail', outcome.blocker.detail)
    span.setAttribute('clef.latch', outcome.latch)
  }
}

/** A hung or failing proxy setup never blocks the call: the deadline and cancel end it, a failure is only logged. */
async function prepareProxyWithin(
  run: TransportRun,
  client: ClefHttpClient,
  signal: AbortSignal
): Promise<'ready' | 'interrupted'> {
  try {
    const raced = await untilAborted(
      () => (run.deps.prepareProxy ?? prepareClefProxy)(client),
      signal
    )
    return raced.aborted ? 'interrupted' : 'ready'
  } catch (error) {
    recordRedactedError(run.span, 'clef.proxy_setup_failed', error, run.wire.secrets)
    return 'ready'
  }
}

async function sendOverWire(run: TransportRun): Promise<ClefTransportOutcome> {
  const { request, deps, wire, span, progress, maxAttempts } = run
  const timers = deps.timers ?? realClefTimers
  const deadline = startClefDeadline(CLEF_OVERALL_DEADLINE_MS, timers)
  const signal = AbortSignal.any(
    request.signal ? [request.signal, deadline.signal] : [deadline.signal]
  )
  try {
    const client = deps.client ?? getMainHttpClient()
    if ((await prepareProxyWithin(run, client, signal)) === 'interrupted') {
      return interruptedOutcome(request.signal, 0, null)
    }
    return await runClefAttempts({
      url: wire.url,
      init: {
        method: 'POST',
        headers: { Authorization: wire.authorization, 'Content-Type': 'application/json' },
        body: wire.body,
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store'
      },
      secrets: wire.secrets,
      fetch: (url, init) => client.fetch(url, init),
      signal,
      callerSignal: request.signal,
      maxAttempts,
      beforeAttempt: request.beforeAttempt,
      random: deps.random ?? Math.random,
      sleep: deps.sleep ?? ((ms, signal) => abortableSleep(ms, signal, timers)),
      span,
      progress
    })
  } finally {
    deadline.dispose()
  }
}

function attemptBudget(requested: number | undefined): number | null {
  const wanted = requested ?? CLEF_DEFAULT_MAX_ATTEMPTS
  return Number.isInteger(wanted) && wanted >= 1
    ? Math.min(wanted, CLEF_DEFAULT_MAX_ATTEMPTS)
    : null
}

async function runTransport(
  request: ClefTransportRequest,
  deps: ClefTransportDeps,
  span: ActiveSpan,
  progress: TransportProgress
): Promise<ClefTransportOutcome> {
  const maxAttempts = attemptBudget(request.maxAttempts)
  // Why a run-time check too: a caller outside the type system must not reach the wire without the ledger.
  if (maxAttempts === null || typeof request.beforeAttempt !== 'function') {
    return blockedOutcome(BUDGET_EXHAUSTED_BLOCKER, 'vetoed', 0)
  }
  // Why a copy: every attempt must send exactly the bytes checked here, even if the caller reuses its buffer.
  const body = Uint8Array.from(request.body)
  if (!isPinnedClefRequestBody(body)) {
    const rejected = { reason: 'classifier_unavailable', detail: 'request_rejected' } as const
    return blockedOutcome(rejected, 'request_invalid', 0)
  }
  const wire = resolveWire(request.credentials, body)
  if (!wire) {
    const unconfigured = { reason: 'classifier_unavailable', detail: 'not_configured' } as const
    return blockedOutcome(unconfigured, 'credentials_unavailable', 0)
  }
  progress.secrets = wire.secrets
  if (request.signal?.aborted) {
    return { kind: 'aborted', attempts: 0 }
  }
  return sendOverWire({ request, deps, wire, span, progress, maxAttempts })
}

/**
 * The only Clef HTTP call site. Never throws: returns raw bytes and status for the
 * validator, a mapped blocker, or `aborted` when the caller's signal fired.
 */
export function sendClefRequest(
  request: ClefTransportRequest,
  deps: ClefTransportDeps = {}
): Promise<ClefTransportOutcome> {
  return withSpan(
    'clef.transport',
    async (span) => {
      const progress: TransportProgress = { attempts: 0, secrets: [] }
      let outcome: ClefTransportOutcome
      try {
        outcome = await runTransport(request, deps, span, progress)
      } catch (error) {
        recordRedactedError(span, 'clef.internal_error', error, progress.secrets)
        const transient = {
          reason: 'classifier_unavailable',
          detail: 'transient_exhausted'
        } as const
        outcome = blockedOutcome(transient, 'internal', progress.attempts)
      }
      annotateOutcome(span, outcome)
      return outcome
    },
    { attributes: { 'clef.urlTemplate': CLEF_URL_TEMPLATE } }
  )
}
