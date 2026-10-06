import type { RouteBlocker } from '../../shared/clef/clef-route-contract'
import type { ClefCredentialGeneration } from './clef-credential-generation'

/** Circuit and latch policy (spec section 7). Pure reducers plus a thin holder; time is injected. */
export const CLEF_CIRCUIT_FAILURE_THRESHOLD = 3
export const CLEF_CIRCUIT_COOL_DOWN_MS = 5 * 60_000

export type ClefCallOutcome =
  | 'success'
  | 'transient_exhausted'
  | 'auth_failed'
  | 'quota_latched'
  | 'other_failure'

export type ClefCircuitState = Readonly<{
  consecutiveTransient: number
  /** Null while closed; set when the circuit opened (or reopened from half-open). */
  openedAt: number | null
  halfOpen: boolean
  /** Opaque credentials generation in force when auth failed; any other generation clears the latch. */
  authFailedGeneration: ClefCredentialGeneration | null
  quotaLatchedUntil: number | null
}>

export type ClefCallGate =
  | { allowed: true; halfOpen: boolean }
  | {
      allowed: false
      status: 'auth_failed' | 'quota_latched' | 'circuit_open'
      /** Epoch ms when the gate may allow again; null when only new credentials help. */
      retryAt: number | null
      blocker: RouteBlocker
    }

export type ClefCircuitSnapshot = {
  circuit: 'closed' | 'open' | 'half_open'
  reopensAt: number | null
  authFailed: boolean
  quotaLatchedUntil: number | null
  consecutiveTransient: number
}

export const INITIAL_CLEF_CIRCUIT_STATE: ClefCircuitState = Object.freeze({
  consecutiveTransient: 0,
  openedAt: null,
  halfOpen: false,
  authFailedGeneration: null,
  quotaLatchedUntil: null
})

function withChanges(state: ClefCircuitState, changes: Partial<ClefCircuitState>) {
  return Object.freeze({ ...state, ...changes })
}

export function nextUtcMidnight(now: number): number {
  const date = new Date(now)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1)
}

function coolDownElapsed(openedAt: number, now: number): boolean {
  return now - openedAt >= CLEF_CIRCUIT_COOL_DOWN_MS
}

function blocked(
  status: 'auth_failed' | 'quota_latched' | 'circuit_open',
  retryAt: number | null
): ClefCallGate {
  const detail =
    status === 'auth_failed'
      ? 'auth_or_account'
      : status === 'quota_latched'
        ? 'quota_exhausted'
        : 'transient_exhausted'
  return { allowed: false, status, retryAt, blocker: { reason: 'classifier_unavailable', detail } }
}

function clearExpiredLatches(
  state: ClefCircuitState,
  now: number,
  generation: ClefCredentialGeneration
): ClefCircuitState {
  const authStale =
    state.authFailedGeneration !== null && !state.authFailedGeneration.equals(generation)
  const quotaStale = state.quotaLatchedUntil !== null && now >= state.quotaLatchedUntil
  if (!authStale && !quotaStale) {
    return state
  }
  return withChanges(state, {
    ...(authStale ? { authFailedGeneration: null } : {}),
    ...(quotaStale ? { quotaLatchedUntil: null } : {})
  })
}

/** Clears an auth_failed latch held for any other credentials generation; touches nothing else. */
export function liftStaleClefAuthLatch(
  state: ClefCircuitState,
  generation: ClefCredentialGeneration
): ClefCircuitState {
  if (state.authFailedGeneration === null || state.authFailedGeneration.equals(generation)) {
    return state
  }
  return withChanges(state, { authFailedGeneration: null })
}

/** Run on each on-demand trigger; half-opens a cooled circuit without any probe call. */
export function evaluateClefCallGate(
  current: ClefCircuitState,
  now: number,
  generation: ClefCredentialGeneration
): { gate: ClefCallGate; state: ClefCircuitState } {
  const state = clearExpiredLatches(current, now, generation)
  if (state.authFailedGeneration !== null) {
    return { gate: blocked('auth_failed', null), state }
  }
  if (state.quotaLatchedUntil !== null) {
    return { gate: blocked('quota_latched', state.quotaLatchedUntil), state }
  }
  if (state.openedAt !== null && !state.halfOpen) {
    if (!coolDownElapsed(state.openedAt, now)) {
      return { gate: blocked('circuit_open', state.openedAt + CLEF_CIRCUIT_COOL_DOWN_MS), state }
    }
    return {
      gate: { allowed: true, halfOpen: true },
      state: withChanges(state, { halfOpen: true })
    }
  }
  return { gate: { allowed: true, halfOpen: state.halfOpen }, state }
}

function recordTransient(state: ClefCircuitState, now: number): ClefCircuitState {
  const consecutiveTransient = state.consecutiveTransient + 1
  if (state.halfOpen || consecutiveTransient >= CLEF_CIRCUIT_FAILURE_THRESHOLD) {
    return withChanges(state, { consecutiveTransient, openedAt: now, halfOpen: false })
  }
  return withChanges(state, { consecutiveTransient })
}

export function recordClefCallOutcome(
  state: ClefCircuitState,
  outcome: ClefCallOutcome,
  now: number,
  generation: ClefCredentialGeneration
): ClefCircuitState {
  switch (outcome) {
    case 'success':
      return withChanges(state, { consecutiveTransient: 0, openedAt: null, halfOpen: false })
    case 'transient_exhausted':
      return recordTransient(state, now)
    case 'auth_failed':
      return withChanges(state, { consecutiveTransient: 0, authFailedGeneration: generation })
    case 'quota_latched':
      return withChanges(state, {
        consecutiveTransient: 0,
        quotaLatchedUntil: nextUtcMidnight(now)
      })
    case 'other_failure':
      return withChanges(state, { consecutiveTransient: 0 })
  }
}

/** Read-only view for status surfaces; never transitions the circuit. */
export function describeClefCircuit(
  state: ClefCircuitState,
  now: number,
  generation: ClefCredentialGeneration
): ClefCircuitSnapshot {
  const coolingDown =
    state.openedAt !== null && !state.halfOpen && !coolDownElapsed(state.openedAt, now)
  const circuit = coolingDown ? 'open' : state.openedAt === null ? 'closed' : 'half_open'
  const quotaActive = state.quotaLatchedUntil !== null && now < state.quotaLatchedUntil
  return {
    circuit,
    reopensAt:
      coolingDown && state.openedAt !== null ? state.openedAt + CLEF_CIRCUIT_COOL_DOWN_MS : null,
    authFailed: state.authFailedGeneration?.equals(generation) === true,
    quotaLatchedUntil: quotaActive ? state.quotaLatchedUntil : null,
    consecutiveTransient: state.consecutiveTransient
  }
}

/**
 * Pass the generation read from the credential source before the call, to `gate` and to `record`
 * alike, so an auth failure latches the credentials that were actually sent.
 */
export type ClefCallCircuit = {
  gate(generation: ClefCredentialGeneration): ClefCallGate
  record(outcome: ClefCallOutcome, generation: ClefCredentialGeneration): void
  snapshot(generation: ClefCredentialGeneration): ClefCircuitSnapshot
  /** Credential-change hook: drops an auth latch for older credentials without a gate transition. */
  liftAuthLatch(generation: ClefCredentialGeneration): void
}

/** Main-process holder: swaps immutable states, reading time only from the injected clock. */
export function createClefCallCircuit(clock: { now(): number }): ClefCallCircuit {
  let state = INITIAL_CLEF_CIRCUIT_STATE
  return {
    gate(generation) {
      const evaluated = evaluateClefCallGate(state, clock.now(), generation)
      state = evaluated.state
      return evaluated.gate
    },
    record(outcome, generation) {
      state = recordClefCallOutcome(state, outcome, clock.now(), generation)
    },
    snapshot(generation) {
      return describeClefCircuit(state, clock.now(), generation)
    },
    liftAuthLatch(generation) {
      state = liftStaleClefAuthLatch(state, generation)
    }
  }
}
