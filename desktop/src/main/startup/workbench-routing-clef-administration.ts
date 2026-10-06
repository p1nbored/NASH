import { join } from 'node:path'
import { CLEF_SCHEMA_PINS, createPinCheckedProfileSource } from '../clef/clef-schema-pins'
import { createClefSpendLedger } from '../clef/clef-spend-ledger'
import { sendClefRequest } from '../clef/clef-transport'
import {
  CLEF_VERIFIED_PROFILE_FILE_NAME,
  createClefVerifiedProfileFileStore,
  createNodeClefVerifiedProfileFs
} from '../clef/clef-verified-profile'
import type { OrchestrationDb } from '../runtime/orchestration/db/orchestration-db'
import { getWorkbenchRouteStore } from '../runtime/orchestration/db/workbench-route-store'
import type { TaskClassificationRuntimeDeps } from '../runtime/task-classification/classification-runtime'
import type { ClefVerifierDeps } from '../runtime/workbench-routing/clef-verifier'
import { createRoutingAbortRegistry } from '../runtime/workbench-routing/routing-abort-registry'
import {
  createWorkbenchRoutingRuntime,
  getWorkbenchRoutingRuntime,
  setWorkbenchRoutingRuntime,
  type WorkbenchRoutingRuntime
} from '../runtime/workbench-routing/workbench-routing-runtime'
import { createRoutingFailureLogger } from './workbench-routing-failure-log'

/** The main-process capabilities the Clef runtime is built from; the electron-backed ones arrive as ports. */
export type ClefAdministrationInput = {
  /** The opened orchestration database; recovery and every spend write run on it. */
  readonly owner: OrchestrationDb
  /** Orca's user data directory; the verified profile file lives directly under it. */
  readonly userDataPath: string
  /** The sealed Clef credential source installed at startup; nothing here reads it. */
  readonly credentials: ClefVerifierDeps['credentials']
  /** Defaults to the one Clef HTTP call site. */
  readonly transport?: ClefVerifierDeps['transport']
  readonly now?: () => number
  /** Where redacted failures go; defaults to the console. */
  readonly logFailure?: (message: string, details: Record<string, unknown>) => void
}

/** What the TaskSpec classifier shares with Clef administration: one ledger, profile and transport. */
export type ClefClassifierPorts = Pick<
  TaskClassificationRuntimeDeps,
  'ledger' | 'credentials' | 'verifiedProfile' | 'transport'
>

export type ClefAdministration = {
  readonly runtime: WorkbenchRoutingRuntime
  readonly classifier: ClefClassifierPorts
  /** Will-quit: aborts any verification call still open and unpublishes the runtime. */
  uninstall(): void
}

/**
 * Builds the Clef administration runtime (status, verification, pin) and publishes it. Call after the
 * orchestration database opens. Recovery runs first: it closes reservations an earlier run left open
 * and blocks any request an earlier build left in ROUTING. Nothing here calls Clef or reads a secret.
 */
export function installClefAdministration(input: ClefAdministrationInput): ClefAdministration {
  const now = input.now ?? Date.now
  const routes = getWorkbenchRouteStore(input.owner)
  // Why first: a crashed verification call leaves a reservation open, and an older build may leave a request in ROUTING.
  routes.recoverInterruptedRouting()
  const logFailure = createRoutingFailureLogger(input.logFailure)
  const profileFile = createClefVerifiedProfileFileStore({
    fs: createNodeClefVerifiedProfileFs(),
    filePath: join(input.userDataPath, CLEF_VERIFIED_PROFILE_FILE_NAME)
  })
  // Why one ledger: verification and classification share one spend record; no cap (D-022).
  const ledger = createClefSpendLedger({ store: routes.spend, now })
  // Why wrapped: a profile pinned against other contracts reads as absent until verified again.
  const verifiedProfile = createPinCheckedProfileSource(profileFile, CLEF_SCHEMA_PINS, logFailure)
  const transport = input.transport ?? sendClefRequest
  const runtime = createWorkbenchRoutingRuntime({
    ledger,
    credentials: input.credentials,
    verifiedProfile,
    transport,
    aborts: createRoutingAbortRegistry(),
    clock: { now },
    onFailure: logFailure,
    admin: {
      spend: routes.spend,
      profileStore: profileFile,
      schemaPins: CLEF_SCHEMA_PINS
    }
  })
  setWorkbenchRoutingRuntime(runtime)
  return {
    runtime,
    classifier: { ledger, credentials: input.credentials, verifiedProfile, transport },
    uninstall: () => {
      runtime.abortAllRouting()
      if (getWorkbenchRoutingRuntime() === runtime) {
        setWorkbenchRoutingRuntime(null)
      }
    }
  }
}
