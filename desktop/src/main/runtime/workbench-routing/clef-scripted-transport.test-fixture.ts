// FIXTURE_ONLY: scripted Clef transports for the verifier and runtime tests; production code never imports this.
// No network and no credentials: each transport asks the caller's permit hook, as the real one does, then returns a canned outcome.

import type { RouteBlocker } from '../../../shared/clef/clef-route-contract'
import type { ClefTransportPort } from '../../clef/clef-call-ports'
import type { ClefLatchKind } from '../../clef/clef-error-mapping'
import type { ClefTransportRequest } from '../../clef/clef-transport'
import type {
  ClefTransportBlocked,
  ClefTransportErrorClass
} from '../../clef/clef-transport-outcome'
import { fixtureClefResponseBytes, type FixtureClefAnswer } from './workbench-routing.test-fixture'

const FIXTURE_BUDGET_BLOCKER: RouteBlocker = {
  reason: 'classifier_unavailable',
  detail: 'budget_exhausted'
}

/** Asks the caller's hook for a permit, as the real transport does before each billed attempt. */
async function permit(
  request: ClefTransportRequest,
  attempt: number
): Promise<ClefTransportBlocked | null> {
  const answer = await request.beforeAttempt(attempt)
  return answer.proceed
    ? null
    : {
        kind: 'blocked',
        blocker: answer.blocker ?? FIXTURE_BUDGET_BLOCKER,
        latch: null,
        status: null,
        errorClass: 'vetoed',
        attempts: attempt - 1
      }
}

export function transportResponseBytes(bytes: Uint8Array, status = 200): ClefTransportPort {
  return async (request) =>
    (await permit(request, 1)) ?? { kind: 'response', status, bytes, attempts: 1 }
}

/** Answers every question of the body it was sent, as a live Clef reply would. */
export function transportResponding(answer: FixtureClefAnswer = {}): ClefTransportPort {
  return async (request) =>
    (await permit(request, 1)) ?? {
      kind: 'response',
      status: 200,
      bytes: fixtureClefResponseBytes(request.body, answer),
      attempts: 1
    }
}

export type FixtureBlockedOptions = {
  readonly attempts?: number
  readonly latch?: ClefLatchKind | null
  readonly status?: number | null
}

/** One billed attempt that ends in a mapped failure. */
export function transportBlocked(
  blocker: RouteBlocker,
  errorClass: ClefTransportErrorClass,
  options: FixtureBlockedOptions = {}
): ClefTransportPort {
  return async (request) =>
    (await permit(request, 1)) ?? {
      kind: 'blocked',
      blocker,
      latch: options.latch ?? null,
      status: options.status ?? null,
      errorClass,
      attempts: options.attempts ?? 1
    }
}

/** Takes the permit, signals that the call is in flight, and ends only when the caller aborts. */
export function transportHangingUntilAborted(onInFlight: () => void): ClefTransportPort {
  return async (request) => {
    const vetoed = await permit(request, 1)
    if (vetoed) {
      return vetoed
    }
    onInFlight()
    await new Promise<void>((resolve) => {
      if (request.signal?.aborted) {
        resolve()
        return
      }
      request.signal?.addEventListener('abort', () => resolve(), { once: true })
    })
    return { kind: 'aborted', attempts: 1 }
  }
}

export type HeldTransport = {
  readonly transport: ClefTransportPort
  /** Resolves once the first attempt holds its permit and the call is in flight. */
  readonly inFlight: Promise<void>
  /** Lets the held call return its answer. */
  release(): void
}

/** A call that takes its permit, then waits for the test before it answers. */
export function transportHeldUntilReleased(answer: FixtureClefAnswer = {}): HeldTransport {
  let release: () => void = () => undefined
  let markInFlight: () => void = () => undefined
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  const inFlight = new Promise<void>((resolve) => {
    markInFlight = resolve
  })
  return {
    inFlight,
    release: () => release(),
    transport: async (request) => {
      const vetoed = await permit(request, 1)
      if (vetoed) {
        return vetoed
      }
      markInFlight()
      await released
      return {
        kind: 'response',
        status: 200,
        bytes: fixtureClefResponseBytes(request.body, answer),
        attempts: 1
      }
    }
  }
}
