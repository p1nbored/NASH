// FIXTURE_ONLY: in-memory harness for the Workbench intake door, the Clef administration runtime and
// their RPC methods; production code never imports this. No network, no real credentials and no
// Electron: the database is in memory and every port is a fake.

import { vi, type Mock } from 'vitest'
import type { WorkbenchRequest } from '../../../shared/workbench-request'
import { createClefCallCircuit, type ClefCallCircuit } from '../../clef/clef-call-circuit'
import { setClefCallCircuit } from '../../clef/clef-call-circuit-owner'
import { createClefSpendLedger, type ClefSpendLedger } from '../../clef/clef-spend-ledger'
import { CLEF_SCHEMA_PINS } from '../../clef/clef-schema-pins'
import type { ClefTransportRequest } from '../../clef/clef-transport'
import type { ClefTransportBlocked } from '../../clef/clef-transport-outcome'
import {
  clefVerifiedProfileHash,
  type ClefVerifiedProfile,
  type ClefVerifiedProfileRecord
} from '../../clef/clef-verified-profile'
import { OrchestrationDb } from '../orchestration/db/orchestration-db'
import {
  getWorkbenchRequestStore,
  type WorkbenchRequestStore
} from '../orchestration/db/workbench-request-store'
import { WorkbenchRouteStore } from '../orchestration/db/workbench-route-store'
import {
  routeFixturePrincipal,
  routeFixtureWorkspace
} from '../orchestration/db/workbench-route-test-fixture'
import type { ClefVerifierDeps } from './clef-verifier'
import { createRoutingAbortRegistry, type RoutingAbortRegistry } from './routing-abort-registry'
import type {
  WorkbenchClefAdminDeps,
  WorkbenchRoutingRuntimeDeps
} from './workbench-routing-runtime'
import {
  FIXTURE_ONLY_NOW_MS,
  fixtureClefResponseBytes,
  fixtureCredentialPort,
  fixtureProfileRecord,
  type FixtureCredentialPort
} from './workbench-routing.test-fixture'

export const FIXTURE_ONLY_PRINCIPAL = routeFixturePrincipal
export const FIXTURE_ONLY_WORKSPACE = routeFixtureWorkspace

type ClefTransportPort = ClefVerifierDeps['transport']

const BUDGET_BLOCKER = { reason: 'classifier_unavailable', detail: 'budget_exhausted' } as const

/** Asks the verifier's hook for a permit, as the real transport does before each billed attempt. */
async function permit(request: ClefTransportRequest): Promise<ClefTransportBlocked | null> {
  const answer = await request.beforeAttempt(1)
  return answer.proceed
    ? null
    : {
        kind: 'blocked',
        blocker: answer.blocker ?? BUDGET_BLOCKER,
        latch: null,
        status: null,
        errorClass: 'vetoed',
        attempts: 0
      }
}

/** Answers every question of the body it was sent, as a live Clef reply would. */
export function transportResponding(): ClefTransportPort {
  return async (request) =>
    (await permit(request)) ?? {
      kind: 'response',
      status: 200,
      bytes: fixtureClefResponseBytes(request.body),
      attempts: 1
    }
}

/** Takes the permit, signals that the call is in flight, and ends only when the caller aborts. */
export function transportHangingUntilAborted(onInFlight: () => void): ClefTransportPort {
  return async (request) => {
    const vetoed = await permit(request)
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

export type RuntimeHarnessOptions = {
  readonly profile?: ClefVerifiedProfileRecord | null
}

export type RuntimeHarness = {
  readonly owner: OrchestrationDb
  readonly requests: WorkbenchRequestStore
  readonly routes: WorkbenchRouteStore
  readonly ledger: ClefSpendLedger
  readonly circuit: ClefCallCircuit
  readonly credentials: FixtureCredentialPort
  readonly aborts: RoutingAbortRegistry
  readonly clock: { ms: number }
  /** Every Clef call the runtime makes; intake and cancel must leave it untouched. */
  readonly transport: Mock<ClefTransportPort>
  /** Every profile the fixture store was asked to write, in order. */
  readonly profileWrites: ClefVerifiedProfile[]
  readonly deps: WorkbenchRoutingRuntimeDeps
  /** The administration wiring `main` builds, with an in-memory profile store. */
  readonly admin: WorkbenchClefAdminDeps
  /** Test control: the verified profile the runtime reads; null removes it. */
  setProfile(profile: ClefVerifiedProfileRecord | null): void
  request(requestId: string): WorkbenchRequest
  events(requestId: string): string[]
  spendRows(): Record<string, unknown>[]
  rawRows(): Record<string, unknown>[]
  close(): void
}

export function createRuntimeHarness(options: RuntimeHarnessOptions = {}): RuntimeHarness {
  const owner = new OrchestrationDb(':memory:')
  const clock = { ms: FIXTURE_ONLY_NOW_MS }
  const requests = getWorkbenchRequestStore(owner)
  const routes = new WorkbenchRouteStore(owner.db, () => new Date(clock.ms))
  const ledger = createClefSpendLedger({ store: routes.spend, now: () => clock.ms })
  // Why: status reads the single circuit owner, so the harness installs its fixture-clock circuit there.
  const circuit = createClefCallCircuit({ now: () => clock.ms })
  setClefCallCircuit(circuit)
  const credentials = fixtureCredentialPort()
  const aborts = createRoutingAbortRegistry()
  const transport = vi.fn<ClefTransportPort>(transportResponding())
  const profileWrites: ClefVerifiedProfile[] = []
  let profile = options.profile === undefined ? fixtureProfileRecord() : options.profile
  const admin: WorkbenchClefAdminDeps = {
    spend: routes.spend,
    // Why: it behaves like the file store, so a write is what the next read returns.
    profileStore: {
      read: () => profile,
      write(next) {
        profileWrites.push(next)
        profile = { profile: next, profileHash: clefVerifiedProfileHash(next) }
        return profile
      }
    },
    schemaPins: CLEF_SCHEMA_PINS
  }
  return {
    owner,
    requests,
    routes,
    ledger,
    circuit,
    credentials,
    aborts,
    clock,
    transport,
    profileWrites,
    admin,
    deps: {
      ledger,
      credentials,
      verifiedProfile: { read: () => profile },
      transport,
      aborts,
      clock: { now: () => clock.ms }
    },
    setProfile(next) {
      profile = next
    },
    request: (requestId) =>
      requests.get(
        routeFixturePrincipal,
        { workspaceId: routeFixtureWorkspace.workspaceId, requestId },
        routeFixtureWorkspace
      ),
    events: (requestId) =>
      owner.db
        .prepare('SELECT kind FROM workbench_request_events WHERE request_id = ? ORDER BY sequence')
        .all(requestId)
        .map((row) => String(row.kind)),
    spendRows: () =>
      owner.db
        .prepare(
          'SELECT reservation_id, request_id, purpose, attempt, state, input_tokens, spent_micro_usd, spent_neurons FROM workbench_clef_spend ORDER BY sequence'
        )
        .all(),
    rawRows: () =>
      owner.db
        .prepare(
          'SELECT raw_response_id, request_id, spend_reservation_id, http_status, request_body, response_body, response_body_sha256 FROM workbench_clef_raw_responses ORDER BY sequence'
        )
        .all(),
    close: () => {
      setClefCallCircuit(null)
      owner.close()
    }
  }
}
