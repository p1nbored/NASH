import type Database from '../../../sqlite/sync-database'
import type { OrchestrationDb } from './orchestration-db'
import { runLifecycleWriteTransaction } from './lifecycle-write-transaction-runner'
import { ensureWorkbenchRequestSchema } from './workbench-request-schema'
import { WorkbenchClefSpendStore } from './workbench-clef-spend-store'
import { requireIdleWorkbenchConnection } from './workbench-connection-guard'
import {
  insertWorkbenchClefRawResponse,
  type WorkbenchRawResponseInput,
  type WorkbenchRawResponseReceipt
} from './workbench-clef-raw-responses'

export type WorkbenchRoutingRecovery = {
  /** Always 0 since Workbench v3: intake no longer routes, so no request is left mid-routing. */
  blockedRequests: number
  /** Always 0 since Workbench v3, for the same reason. */
  unrecoveredRequests: number
  releasedReservations: number
}

const stores = new WeakMap<OrchestrationDb, WorkbenchRouteStore>()

export function getWorkbenchRouteStore(owner: OrchestrationDb): WorkbenchRouteStore {
  let store = stores.get(owner)
  if (!store) {
    store = new WorkbenchRouteStore(owner.db)
    stores.set(owner, store)
  }
  return store
}

/**
 * Clef spend and raw-response writes. D-016 removed intake routing, so the claim, reblock,
 * decision and outcome writes are gone; every write opens its own top-level transaction.
 */
export class WorkbenchRouteStore {
  readonly spend: WorkbenchClefSpendStore

  constructor(
    private readonly db: Database.Database,
    private readonly now: () => Date = () => new Date()
  ) {
    ensureWorkbenchRequestSchema(db)
    this.spend = new WorkbenchClefSpendStore(db)
  }

  private transaction<T>(operation: () => T): T {
    requireIdleWorkbenchConnection(this.db)
    return runLifecycleWriteTransaction(this.db, 'workbench_route', operation)
  }

  /** Stores exchange bytes before parsing; the table is sensitive at rest. */
  insertRawResponse(input: WorkbenchRawResponseInput): WorkbenchRawResponseReceipt {
    return this.transaction(() =>
      insertWorkbenchClefRawResponse(this.db, input, this.now().toISOString())
    )
  }

  /** Startup only: closes reservations a crashed Clef call left open. No network, no re-route. */
  recoverInterruptedRouting(): WorkbenchRoutingRecovery {
    return this.transaction(() => ({
      blockedRequests: 0,
      unrecoveredRequests: 0,
      releasedReservations: this.spend.releaseUnsettled(this.now().toISOString())
    }))
  }
}
