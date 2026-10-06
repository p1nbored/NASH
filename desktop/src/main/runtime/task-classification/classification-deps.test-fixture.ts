// FIXTURE_ONLY: classifier ports over the memory database, scripted Clef transports and the routing
// table's own test environment. No network, no CLI, no credential: every value here is synthetic.
import { createClassificationSpend } from '../../clef/clef-classification-spend'
import type { ClefTransportPort } from '../../clef/clef-call-ports'
import { createClefSpendLedger, type ClefSpendLedger } from '../../clef/clef-spend-ledger'
import type { ClefVerifiedProfileRecord } from '../../clef/clef-verified-profile'
import { createEvaluatorHarness } from '../../routing-table/availability/route-availability-harness.test-fixture'
import { createRouteResolver } from '../../routing-table/route-resolver'
import {
  ensureActiveRoutingTable,
  resolveActiveRoutingTable
} from '../../routing-table/routing-table-activation'
import { createTestRoutingTableEnvironment } from '../../routing-table/routing-table-test-context.test-fixture'
import { getTaskClassificationStore } from '../orchestration/db/task-classification-store'
import { getTaskRouteStore } from '../orchestration/db/task-route-store'
import { insertWorkbenchClefRawResponse } from '../orchestration/db/workbench-clef-raw-responses'
import { WorkbenchClefSpendStore } from '../orchestration/db/workbench-clef-spend-store'
import { transportResponding } from '../workbench-routing/clef-scripted-transport.test-fixture'
import {
  fixtureClefResponseBytes,
  fixtureCredentialPort,
  fixtureProfileRecord,
  type FixtureClefAnswer,
  type FixtureCredentialPort
} from '../workbench-routing/workbench-routing.test-fixture'
import { createClassificationCache } from './classification-cache'
import {
  createClassificationDbHarness,
  type ClassificationDbHarness
} from './classification-db.test-fixture'
import type { ClassificationRoutingPort, TaskClassifierDeps } from './classification-ports'

export const FIXTURE_CLASSIFY_NOW_MS = Date.parse('2026-10-05T10:00:00.000Z')

export type FixtureTableState = 'installed' | 'taxonomy_mismatch' | 'not_installed'

export type CountedRouting = { readonly port: ClassificationRoutingPort; lookups(): number }

/** The real resolver over the routing table's memory store and a fake availability evaluator. */
export function fixtureRouting(state: FixtureTableState = 'installed'): CountedRouting {
  const env = createTestRoutingTableEnvironment()
  if (state !== 'not_installed') {
    ensureActiveRoutingTable(env.ctx)
  }
  const reader =
    state === 'taxonomy_mismatch'
      ? createTestRoutingTableEnvironment({ fs: env.fs, expectedTaxonomyVersion: 3 })
      : env
  const activeTable = () => resolveActiveRoutingTable(reader.ctx)
  const resolver = createRouteResolver({
    activeTable,
    evaluator: createEvaluatorHarness().evaluator
  })
  let lookups = 0
  return {
    port: {
      activeTable,
      resolveRoute: (input) => {
        lookups += 1
        return resolver.resolveRoute(input)
      }
    },
    lookups: () => lookups
  }
}

export type CountedTransport = { readonly transport: ClefTransportPort; calls(): number }

export function countingTransport(
  inner: ClefTransportPort = transportResponding()
): CountedTransport {
  let calls = 0
  return {
    transport: async (request) => {
      calls += 1
      return inner(request)
    },
    calls: () => calls
  }
}

/** Two billed attempts in one call: a transient failure, then an answer. */
export function transportAnsweringOnRetry(answer: FixtureClefAnswer = {}): ClefTransportPort {
  return async (request) => {
    for (const attempt of [1, 2]) {
      const permit = await request.beforeAttempt(attempt)
      if (!permit.proceed) {
        return {
          kind: 'blocked',
          blocker: permit.blocker ?? {
            reason: 'classifier_unavailable',
            detail: 'budget_exhausted'
          },
          latch: null,
          status: null,
          errorClass: 'vetoed',
          attempts: attempt - 1
        }
      }
    }
    return {
      kind: 'response',
      status: 200,
      bytes: fixtureClefResponseBytes(request.body, answer),
      attempts: 2
    }
  }
}

export type ClassifierHarnessOptions = {
  readonly transport?: ClefTransportPort
  readonly profile?: ClefVerifiedProfileRecord | null
  readonly routing?: CountedRouting
  readonly db?: ClassificationDbHarness
}

export type ClassifierHarness = {
  readonly db: ClassificationDbHarness
  readonly deps: TaskClassifierDeps
  readonly spendStore: WorkbenchClefSpendStore
  readonly ledger: ClefSpendLedger
  readonly credentials: FixtureCredentialPort
  readonly transport: CountedTransport
  readonly routing: CountedRouting
}

export function createClassifierHarness(options: ClassifierHarnessOptions = {}): ClassifierHarness {
  const db = options.db ?? createClassificationDbHarness()
  const { owner } = db
  const now = () => FIXTURE_CLASSIFY_NOW_MS
  const spendStore = new WorkbenchClefSpendStore(owner.db)
  let ids = 0
  const ledger = createClefSpendLedger({
    store: spendStore,
    now,
    newId: () => `spend_fixture_${++ids}`
  })
  const credentials = fixtureCredentialPort()
  const transport = countingTransport(options.transport)
  const routing = options.routing ?? fixtureRouting()
  const profile = options.profile === undefined ? fixtureProfileRecord() : options.profile
  const deps: TaskClassifierDeps = {
    classifications: getTaskClassificationStore(owner),
    routes: getTaskRouteStore(owner),
    rawResponses: {
      insert: (input) =>
        insertWorkbenchClefRawResponse(owner.db, input, new Date(now()).toISOString())
    },
    spend: createClassificationSpend({ store: spendStore, ledger }),
    ledger,
    credentials,
    verifiedProfile: { read: () => profile },
    transport: transport.transport,
    cache: createClassificationCache(),
    routing: routing.port,
    clock: { now },
    newId: () => `fixture_${++ids}`
  }
  return { db, deps, spendStore, ledger, credentials, transport, routing }
}
