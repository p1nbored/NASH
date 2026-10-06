import { describe, expect, it } from 'vitest'
import { ClefCredentialGeneration } from './clef-credential-generation'
import {
  CLEF_CIRCUIT_COOL_DOWN_MS,
  INITIAL_CLEF_CIRCUIT_STATE,
  createClefCallCircuit,
  describeClefCircuit,
  evaluateClefCallGate,
  liftStaleClefAuthLatch,
  nextUtcMidnight,
  recordClefCallOutcome,
  type ClefCallOutcome,
  type ClefCircuitState
} from './clef-call-circuit'

const T0 = Date.parse('2026-10-04T12:00:00.000Z')
// Why two: a save or clear mints a new generation, which is the only thing that lifts the auth latch.
const GENERATION = ClefCredentialGeneration.mint()
const NEXT_GENERATION = ClefCredentialGeneration.mint()

function recordAll(
  state: ClefCircuitState,
  outcomes: readonly ClefCallOutcome[],
  now = T0
): ClefCircuitState {
  return outcomes.reduce(
    (next, outcome) => recordClefCallOutcome(next, outcome, now, GENERATION),
    state
  )
}

function gateAt(state: ClefCircuitState, now: number, generation = GENERATION) {
  return evaluateClefCallGate(state, now, generation)
}

const TRANSIENT_X3: ClefCallOutcome[] = [
  'transient_exhausted',
  'transient_exhausted',
  'transient_exhausted'
]

describe('clef call circuit', () => {
  it('starts closed and allows calls', () => {
    expect(gateAt(INITIAL_CLEF_CIRCUIT_STATE, T0).gate).toEqual({ allowed: true, halfOpen: false })
    expect(describeClefCircuit(INITIAL_CLEF_CIRCUIT_STATE, T0, GENERATION)).toEqual({
      circuit: 'closed',
      reopensAt: null,
      authFailed: false,
      quotaLatchedUntil: null,
      consecutiveTransient: 0
    })
  })

  it('stays closed after two consecutive transient outcomes', () => {
    const state = recordAll(INITIAL_CLEF_CIRCUIT_STATE, TRANSIENT_X3.slice(0, 2))
    expect(gateAt(state, T0).gate.allowed).toBe(true)
  })

  it('opens after three consecutive transient outcomes and blocks with no call', () => {
    const state = recordAll(INITIAL_CLEF_CIRCUIT_STATE, TRANSIENT_X3)
    expect(gateAt(state, T0 + 1000).gate).toEqual({
      allowed: false,
      status: 'circuit_open',
      retryAt: T0 + CLEF_CIRCUIT_COOL_DOWN_MS,
      blocker: { reason: 'classifier_unavailable', detail: 'transient_exhausted' }
    })
    expect(describeClefCircuit(state, T0 + 1000, GENERATION).circuit).toBe('open')
  })

  it.each<ClefCallOutcome>(['success', 'other_failure', 'auth_failed', 'quota_latched'])(
    'a %s outcome breaks the consecutive transient chain',
    (breaker) => {
      const state = recordAll(INITIAL_CLEF_CIRCUIT_STATE, [
        'transient_exhausted',
        'transient_exhausted',
        breaker,
        'transient_exhausted',
        'transient_exhausted'
      ])
      expect(state.openedAt).toBeNull()
      expect(state.consecutiveTransient).toBe(2)
    }
  )

  it('keeps blocking until the five minute cool-down passes', () => {
    const state = recordAll(INITIAL_CLEF_CIRCUIT_STATE, TRANSIENT_X3)
    expect(gateAt(state, T0 + CLEF_CIRCUIT_COOL_DOWN_MS - 1).gate.allowed).toBe(false)
    expect(describeClefCircuit(state, T0 + CLEF_CIRCUIT_COOL_DOWN_MS, GENERATION).circuit).toBe(
      'half_open'
    )
  })

  it('half-opens on the next trigger after the cool-down without any probe', () => {
    const open = recordAll(INITIAL_CLEF_CIRCUIT_STATE, TRANSIENT_X3)
    const { gate, state } = gateAt(open, T0 + CLEF_CIRCUIT_COOL_DOWN_MS)
    expect(gate).toEqual({ allowed: true, halfOpen: true })
    expect(state.halfOpen).toBe(true)
    expect(gateAt(state, T0 + CLEF_CIRCUIT_COOL_DOWN_MS + 1).gate).toEqual({
      allowed: true,
      halfOpen: true
    })
  })

  it('closes on success while half-open', () => {
    const open = recordAll(INITIAL_CLEF_CIRCUIT_STATE, TRANSIENT_X3)
    const halfOpen = gateAt(open, T0 + CLEF_CIRCUIT_COOL_DOWN_MS).state
    const closed = recordClefCallOutcome(
      halfOpen,
      'success',
      T0 + CLEF_CIRCUIT_COOL_DOWN_MS,
      GENERATION
    )
    expect(closed).toEqual(INITIAL_CLEF_CIRCUIT_STATE)
  })

  it('reopens at once on a transient outcome while half-open', () => {
    const open = recordAll(INITIAL_CLEF_CIRCUIT_STATE, TRANSIENT_X3)
    const later = T0 + CLEF_CIRCUIT_COOL_DOWN_MS
    const halfOpen = recordClefCallOutcome(open, 'other_failure', later, GENERATION)
    const probing = gateAt(halfOpen, later).state
    const reopened = recordClefCallOutcome(probing, 'transient_exhausted', later + 5, GENERATION)
    expect(gateAt(reopened, later + 6).gate).toMatchObject({
      allowed: false,
      status: 'circuit_open',
      retryAt: later + 5 + CLEF_CIRCUIT_COOL_DOWN_MS
    })
  })

  it('latches auth_failed until the credentials generation changes', () => {
    const latched = recordClefCallOutcome(INITIAL_CLEF_CIRCUIT_STATE, 'auth_failed', T0, GENERATION)
    expect(gateAt(latched, T0 + 365 * 86_400_000).gate).toEqual({
      allowed: false,
      status: 'auth_failed',
      retryAt: null,
      blocker: { reason: 'classifier_unavailable', detail: 'auth_or_account' }
    })
    expect(describeClefCircuit(latched, T0, GENERATION).authFailed).toBe(true)
    expect(latched.authFailedGeneration).toBe(GENERATION)

    const { gate, state } = gateAt(latched, T0, NEXT_GENERATION)
    expect(gate).toEqual({ allowed: true, halfOpen: false })
    expect(state.authFailedGeneration).toBeNull()
    expect(describeClefCircuit(latched, T0, NEXT_GENERATION).authFailed).toBe(false)
  })

  it('keeps only the opaque generation in the latch state, never a credential string', () => {
    const latched = recordClefCallOutcome(INITIAL_CLEF_CIRCUIT_STATE, 'auth_failed', T0, GENERATION)
    expect(latched.authFailedGeneration).toBeInstanceOf(ClefCredentialGeneration)
    expect(JSON.parse(JSON.stringify(latched))).toMatchObject({ authFailedGeneration: {} })
    const forged = 'Bearer FAKE_CLEF_TOKEN_FIXTURE_ONLY_0000000000'
    // @ts-expect-error -- a free-form string is not a credential generation.
    const forgedGate = gateAt(latched, T0, forged)
    expect(forgedGate).toMatchObject({ gate: { allowed: true } })
  })

  it('latches quota until the next 00:00 UTC', () => {
    const lateNight = Date.parse('2026-10-04T23:59:59.000Z')
    const midnight = Date.parse('2026-10-05T00:00:00.000Z')
    const latched = recordClefCallOutcome(
      INITIAL_CLEF_CIRCUIT_STATE,
      'quota_latched',
      lateNight,
      GENERATION
    )
    expect(gateAt(latched, midnight - 1).gate).toEqual({
      allowed: false,
      status: 'quota_latched',
      retryAt: midnight,
      blocker: { reason: 'classifier_unavailable', detail: 'quota_exhausted' }
    })
    expect(describeClefCircuit(latched, midnight - 1, GENERATION).quotaLatchedUntil).toBe(midnight)

    const { gate, state } = gateAt(latched, midnight)
    expect(gate.allowed).toBe(true)
    expect(state.quotaLatchedUntil).toBeNull()
    expect(describeClefCircuit(latched, midnight, GENERATION).quotaLatchedUntil).toBeNull()
  })

  it('computes the next UTC midnight, a full day ahead at exactly midnight', () => {
    expect(nextUtcMidnight(Date.parse('2026-10-04T00:00:00.000Z'))).toBe(
      Date.parse('2026-10-05T00:00:00.000Z')
    )
    expect(nextUtcMidnight(Date.parse('2026-12-31T18:30:00.000Z'))).toBe(
      Date.parse('2027-01-01T00:00:00.000Z')
    )
  })

  it('reports auth before quota before the open circuit', () => {
    const everything = recordAll(INITIAL_CLEF_CIRCUIT_STATE, [
      ...TRANSIENT_X3,
      'quota_latched',
      'auth_failed'
    ])
    const withOpenCircuit = { ...everything, openedAt: T0, halfOpen: false }
    expect(gateAt(withOpenCircuit, T0 + 1).gate).toMatchObject({ status: 'auth_failed' })
    expect(gateAt(withOpenCircuit, T0 + 1, NEXT_GENERATION).gate).toMatchObject({
      status: 'quota_latched'
    })
    const noQuota = { ...withOpenCircuit, quotaLatchedUntil: null }
    expect(gateAt(noQuota, T0 + 1, NEXT_GENERATION).gate).toMatchObject({ status: 'circuit_open' })
  })

  it('never mutates the state it is given', () => {
    expect(Object.isFrozen(INITIAL_CLEF_CIRCUIT_STATE)).toBe(true)
    const open = recordAll(INITIAL_CLEF_CIRCUIT_STATE, TRANSIENT_X3)
    const snapshot = { ...open }
    gateAt(open, T0 + CLEF_CIRCUIT_COOL_DOWN_MS)
    recordClefCallOutcome(open, 'success', T0, GENERATION)
    expect(open).toEqual(snapshot)
    expect(Object.isFrozen(open)).toBe(true)
  })
})

describe('createClefCallCircuit', () => {
  it('keeps state between calls using only the injected clock', () => {
    let now = T0
    const circuit = createClefCallCircuit({ now: () => now })
    for (const outcome of TRANSIENT_X3) {
      circuit.record(outcome, GENERATION)
    }
    expect(circuit.gate(GENERATION)).toMatchObject({ allowed: false, status: 'circuit_open' })
    expect(circuit.snapshot(GENERATION).circuit).toBe('open')

    now = T0 + CLEF_CIRCUIT_COOL_DOWN_MS
    expect(circuit.gate(GENERATION)).toEqual({ allowed: true, halfOpen: true })
    expect(circuit.snapshot(GENERATION).circuit).toBe('half_open')
    circuit.record('success', GENERATION)
    expect(circuit.snapshot(GENERATION).circuit).toBe('closed')
  })
})

describe('liftStaleClefAuthLatch', () => {
  it('clears an auth latch recorded for older credentials and nothing else', () => {
    const latched = recordAll(INITIAL_CLEF_CIRCUIT_STATE, [
      ...TRANSIENT_X3,
      'quota_latched',
      'auth_failed'
    ])
    const lifted = liftStaleClefAuthLatch(latched, NEXT_GENERATION)
    expect(lifted.authFailedGeneration).toBeNull()
    expect(lifted.quotaLatchedUntil).toBe(latched.quotaLatchedUntil)
    expect(lifted.openedAt).toBe(latched.openedAt)
    expect(Object.isFrozen(lifted)).toBe(true)
  })

  it('keeps the latch for the credentials that failed and leaves an unlatched state as is', () => {
    const latched = recordAll(INITIAL_CLEF_CIRCUIT_STATE, ['auth_failed'])
    expect(liftStaleClefAuthLatch(latched, GENERATION)).toBe(latched)
    expect(liftStaleClefAuthLatch(INITIAL_CLEF_CIRCUIT_STATE, NEXT_GENERATION)).toBe(
      INITIAL_CLEF_CIRCUIT_STATE
    )
  })
})

describe('createClefCallCircuit liftAuthLatch', () => {
  it('lifts the latch on a credentials change without half-opening a cooled circuit', () => {
    let now = T0
    const circuit = createClefCallCircuit({ now: () => now })
    for (const outcome of TRANSIENT_X3) {
      circuit.record(outcome, GENERATION)
    }
    circuit.record('auth_failed', GENERATION)
    now = T0 + CLEF_CIRCUIT_COOL_DOWN_MS

    circuit.liftAuthLatch(NEXT_GENERATION)

    // Why GENERATION: only a cleared latch reads as not failed under the old credentials.
    expect(circuit.snapshot(GENERATION).authFailed).toBe(false)
    // Why: a circuit the lift had half-opened would reopen on this one transient failure.
    circuit.record('transient_exhausted', NEXT_GENERATION)
    expect(circuit.snapshot(NEXT_GENERATION).circuit).toBe('half_open')
  })

  it('keeps the latch when the generation has not changed', () => {
    const circuit = createClefCallCircuit({ now: () => T0 })
    circuit.record('auth_failed', GENERATION)
    circuit.liftAuthLatch(GENERATION)
    expect(circuit.gate(GENERATION)).toMatchObject({ allowed: false, status: 'auth_failed' })
  })
})
