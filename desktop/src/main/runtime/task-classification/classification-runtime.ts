import { randomUUID } from 'node:crypto'
import { createClassificationSpend } from '../../clef/clef-classification-spend'
import type { ClefSpendLedger } from '../../clef/clef-spend-ledger'
import type { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { getTaskClassificationStore } from '../orchestration/db/task-classification-store'
import { getTaskRouteStore } from '../orchestration/db/task-route-store'
import { insertWorkbenchClefRawResponse } from '../orchestration/db/workbench-clef-raw-responses'
import { WorkbenchClefSpendStore } from '../orchestration/db/workbench-clef-spend-store'
import { OrchestrationError } from '../orchestration/orchestration-error'
import { createClassificationCache } from './classification-cache'
import type {
  ClassificationCache,
  ClassificationRunResult,
  TaskClassifierDeps
} from './classification-ports'
import { CLASSIFICATION_CANCELED } from './classification-record'
import {
  recoverInterruptedClassifications,
  type ClassificationRecovery
} from './classification-recovery'
import { loadClassificationSubject } from './classification-subject'
import { createTaskClassifier } from './task-classifier'

export type ClassificationSettled =
  | ({ readonly status: 'recorded'; readonly taskId: string } & ClassificationRunResult)
  /** An unexpected error after the gates; the code is an `autopilot_` code, never a message. */
  | { readonly status: 'failed'; readonly taskId: string; readonly code: string }

export type PendingClassification = {
  readonly status: 'pending'
  readonly taskId: string
  readonly settled: Promise<ClassificationSettled>
}

export type TaskClassificationRuntimeDeps = Pick<
  TaskClassifierDeps,
  'credentials' | 'verifiedProfile' | 'transport' | 'routing' | 'clock'
> & {
  readonly owner: OrchestrationDb
  /** Built over the same database's spend store; it records spend without limits (D-022). */
  readonly ledger: Pick<ClefSpendLedger, 'reserve' | 'settle'>
  readonly cache?: ClassificationCache
  readonly newId?: () => string
  /** Defers each classification past the caller's turn, so `classify` returns at once. */
  readonly schedule?: (task: () => void) => void
  /** Called once per settled classification, for example to post the run mailbox notice. */
  readonly onSettled?: (settled: ClassificationSettled) => void
  /** Sink for unexpected failures; startup installs a redacting logger. */
  readonly onFailure?: (error: unknown) => void
}

export type TaskClassificationRuntime = {
  /** Starts, or joins, the classification of one TaskSpec; the result lands in the store. */
  classify(taskId: string): PendingClassification
  pending(taskId: string): PendingClassification | null
  /** Stops one in-flight classification; it records `discarded_after_cancel`. */
  cancel(taskId: string): boolean
  /** Shutdown: stops every in-flight classification; each records `interrupted`. */
  abortAll(): number
  /** Startup, before the first `classify`. */
  recoverInterrupted(): ClassificationRecovery
}

type InFlight = { readonly pending: PendingClassification; readonly controller: AbortController }

const CLASSIFICATION_FAILED = 'autopilot_classification_failed'

function classifierDepsOf(
  deps: TaskClassificationRuntimeDeps,
  spendStore: WorkbenchClefSpendStore
) {
  const { owner, clock } = deps
  const classifierDeps: TaskClassifierDeps = {
    classifications: getTaskClassificationStore(owner),
    routes: getTaskRouteStore(owner),
    rawResponses: {
      insert: (input) =>
        insertWorkbenchClefRawResponse(owner.db, input, new Date(clock.now()).toISOString())
    },
    spend: createClassificationSpend({ store: spendStore, ledger: deps.ledger }),
    ledger: deps.ledger,
    credentials: deps.credentials,
    verifiedProfile: deps.verifiedProfile,
    transport: deps.transport,
    cache: deps.cache ?? createClassificationCache(),
    routing: deps.routing,
    clock,
    newId: deps.newId ?? randomUUID
  }
  return classifierDeps
}

/**
 * The TaskSpec classifier as the app runs it: one classification per TaskSpec at a time, each started
 * off the caller's turn (the caller gets a pending handle at once) and settled into the stores.
 */
export function createTaskClassificationRuntime(
  deps: TaskClassificationRuntimeDeps
): TaskClassificationRuntime {
  const spendStore = new WorkbenchClefSpendStore(deps.owner.db)
  const classifierDeps = classifierDepsOf(deps, spendStore)
  const classifier = createTaskClassifier(classifierDeps)
  const schedule = deps.schedule ?? ((task: () => void) => void setImmediate(task))
  let inFlight: ReadonlyMap<string, InFlight> = new Map()

  function report(error: unknown): void {
    try {
      deps.onFailure?.(error)
    } catch {
      // Why: a failing sink must not leave a handle unsettled; the settled result still carries the code.
    }
  }

  function settle(taskId: string, settled: ClassificationSettled): ClassificationSettled {
    inFlight = new Map([...inFlight].filter(([id]) => id !== taskId))
    try {
      deps.onSettled?.(settled)
    } catch (error) {
      report(error)
    }
    return settled
  }

  async function run(taskId: string, controller: AbortController): Promise<ClassificationSettled> {
    try {
      // Why loaded again: the run may have ended between the request and this turn.
      const subject = loadClassificationSubject(deps.owner, taskId)
      const result = await classifier.classify(subject, controller.signal)
      return settle(taskId, { status: 'recorded', taskId, ...result })
    } catch (error) {
      report(error)
      const code = error instanceof OrchestrationError ? error.code : CLASSIFICATION_FAILED
      return settle(taskId, { status: 'failed', taskId, code })
    }
  }

  return {
    classify(taskId) {
      const running = inFlight.get(taskId)
      if (running !== undefined) {
        return running.pending
      }
      loadClassificationSubject(deps.owner, taskId)
      const controller = new AbortController()
      let resolveSettled: (settled: ClassificationSettled) => void = () => undefined
      const settled = new Promise<ClassificationSettled>((resolve) => {
        resolveSettled = resolve
      })
      const pending: PendingClassification = { status: 'pending', taskId, settled }
      // Why before scheduling: the entry exists even if a scheduler runs the task at once.
      inFlight = new Map([...inFlight, [taskId, { pending, controller }]])
      let started = false
      try {
        schedule(() => {
          started = true
          void run(taskId, controller).then(resolveSettled)
        })
      } catch (error) {
        report(error)
        // Why settle here: nothing will run, and a stuck entry would be joined by every later call.
        if (!started) {
          resolveSettled(settle(taskId, { status: 'failed', taskId, code: CLASSIFICATION_FAILED }))
        }
      }
      return pending
    },
    pending: (taskId) => inFlight.get(taskId)?.pending ?? null,
    cancel(taskId) {
      const running = inFlight.get(taskId)
      running?.controller.abort(CLASSIFICATION_CANCELED)
      return running !== undefined
    },
    abortAll() {
      const running = [...inFlight.values()]
      for (const entry of running) {
        entry.controller.abort()
      }
      return running.length
    },
    recoverInterrupted: () =>
      recoverInterruptedClassifications({
        spend: spendStore,
        classifications: classifierDeps.classifications,
        now: () => deps.clock.now()
      })
  }
}

let installed: TaskClassificationRuntime | null = null

/** Main startup installs the runtime after the database opens and recovery ran; null removes it. */
export function setTaskClassificationRuntime(runtime: TaskClassificationRuntime | null): void {
  installed = runtime
}

/** Null until installed. */
export function getTaskClassificationRuntime(): TaskClassificationRuntime | null {
  return installed
}
