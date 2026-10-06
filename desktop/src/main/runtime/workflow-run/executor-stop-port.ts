import type { OrcaRuntimeService } from '../orca-runtime'
import type { OrchestrationDb } from '../orchestration/db'
import { getAppAttemptSettlement } from '../orchestration/db/app-attempt-settlement'
import type {
  EXECUTOR_TREE_METHODS,
  EXECUTOR_TREE_VERDICTS
} from '../orchestration/db/autopilot-task-schema-definition'
import { OrchestrationError } from '../orchestration/orchestration-error'
import { APP_RUN_POLICY_ERROR_CODES, appRunRefusal } from './app-run-policy'
import { appRunReadersFor, type AppRunReaders, type ExecutorKind } from './app-run-readers'

export type ExecutorTreeVerdict = (typeof EXECUTOR_TREE_VERDICTS)[number]
export type ExecutorTreeMethod = (typeof EXECUTOR_TREE_METHODS)[number]

export type ExecutorStopRequest = { dispatchId: string; kind: ExecutorKind }
/** What the executor proved about its process tree after the cancel; only `exited` settles a stop. */
export type ExecutorStopOutcome = { verdict: ExecutorTreeVerdict; method: ExecutorTreeMethod }

/**
 * The stop side of the app's Codex and agy executors (task-execution, package C4). It cancels the
 * attempt's own child process and reports the tree verdict; it never settles Orca rows itself.
 */
export type ExecutorStopPort = {
  stopExecutor(request: ExecutorStopRequest): Promise<ExecutorStopOutcome>
}

export type AppExecutorStopReceipt = {
  dispatchId: string
  state: string
  alreadySettled: boolean
  processAction: string
  lastError?: string | null
}

const portByRuntime = new WeakMap<OrcaRuntimeService, ExecutorStopPort>()
// Orca's own settled worker states: a stop for one of them has nothing left to do.
const SETTLED_WORKER_STATES: ReadonlySet<string> = new Set([
  'succeeded',
  'failed',
  'stopped',
  'abandoned'
])

/** Called once at wiring time; returns the unregister. A second port for one runtime is a wiring bug. */
export function registerExecutorStopPort(
  runtime: OrcaRuntimeService,
  port: ExecutorStopPort
): () => void {
  if (portByRuntime.has(runtime)) {
    throw new Error('An executor stop port is already registered for this runtime.')
  }
  portByRuntime.set(runtime, port)
  return () => {
    if (portByRuntime.get(runtime) === port) {
      portByRuntime.delete(runtime)
    }
  }
}

/** What B3's settleStop is told: a verdict, a reason code (never free text) and the tree evidence. */
type StopDecision = {
  stopVerdict: ExecutorTreeVerdict
  reason: string
  tree?: ExecutorStopOutcome
  processAction: string
}

function decisionFor(outcome: ExecutorStopOutcome): StopDecision {
  return outcome.verdict === 'exited'
    ? {
        stopVerdict: 'exited',
        reason: 'stopped_on_request',
        tree: outcome,
        processAction: 'stopped_executor'
      }
    : {
        stopVerdict: outcome.verdict,
        reason: `executor_tree_${outcome.verdict}`,
        tree: outcome,
        processAction: 'unknown'
      }
}

async function askPort(
  runtime: OrcaRuntimeService,
  request: ExecutorStopRequest
): Promise<StopDecision> {
  const port = portByRuntime.get(runtime)
  if (!port) {
    return {
      stopVerdict: 'unverifiable',
      reason: 'executor_stop_unavailable',
      processAction: 'none'
    }
  }
  try {
    return decisionFor(await port.stopExecutor(request))
  } catch {
    // Why: the error text can carry a command line or token, so only a fixed reason is recorded.
    return { stopVerdict: 'unverifiable', reason: 'executor_stop_failed', processAction: 'unknown' }
  }
}

/** The receipt when something else settled the attempt while the cancel was awaited. */
function settledMeanwhile(
  runtime: OrcaRuntimeService,
  db: OrchestrationDb,
  dispatchId: string
): AppExecutorStopReceipt | null {
  const state = db.getWorkerDispatch(dispatchId)?.state
  if (!state || !SETTLED_WORKER_STATES.has(state)) {
    return null
  }
  if (state !== 'stopped') {
    return { dispatchId, state, alreadySettled: true, processAction: 'none' }
  }
  // That exit is this stop's proof, so it is reported as this stop's outcome.
  runtime.notifyMessageArrived(`dispatch:${dispatchId}`, 'status')
  return { dispatchId, state, alreadySettled: false, processAction: 'stopped_executor' }
}

/**
 * The worker-stop branch for an app-owned Codex or agy attempt, which has no agent terminal: it asks
 * the executor port, then records the outcome through B3's settleStop, the only writer of app-attempt
 * settlement (it keeps the executor row, Dispatch, worker and Task consistent). Returns null for any
 * other dispatch so the caller continues down Orca's own path unchanged.
 */
export async function stopAppExecutorAttempt(
  runtime: OrcaRuntimeService,
  dispatchId: string,
  readers?: AppRunReaders
): Promise<AppExecutorStopReceipt | null> {
  const db = runtime.getOrchestrationDb()
  const attempt = (readers ?? appRunReadersFor(db)).findExecutorAttempt(dispatchId)
  if (!attempt) {
    return null
  }
  const worker = db.getWorkerDispatch(dispatchId)
  if (worker && SETTLED_WORKER_STATES.has(worker.state)) {
    return { dispatchId, state: worker.state, alreadySettled: true, processAction: 'none' }
  }
  if (worker?.state === 'start_unknown') {
    // Why: B3 cannot record a stop for an unknown start, and an unrecorded kill is worse than none.
    throw appRunRefusal(
      APP_RUN_POLICY_ERROR_CODES.stopUnavailable,
      `Attempt ${dispatchId} has an unknown start outcome, so its stop cannot be recorded. Decide it with the user.`
    )
  }
  const decision = await askPort(runtime, { dispatchId, kind: attempt.kind })
  try {
    const view = getAppAttemptSettlement(db).settleStop({
      dispatchId,
      stopVerdict: decision.stopVerdict,
      reason: decision.reason,
      ...(decision.tree ? { tree: decision.tree } : {}),
      timestamp: new Date().toISOString()
    })
    if (view.workerState === 'stopped') {
      runtime.notifyMessageArrived(`dispatch:${dispatchId}`, 'status')
      return {
        dispatchId,
        state: view.workerState,
        alreadySettled: false,
        processAction: decision.processAction
      }
    }
    return {
      dispatchId,
      state: view.workerState,
      alreadySettled: false,
      processAction: decision.processAction,
      lastError: decision.reason
    }
  } catch (error) {
    const meanwhile =
      error instanceof OrchestrationError && error.code === 'autopilot_attempt_conflict'
        ? settledMeanwhile(runtime, db, dispatchId)
        : null
    if (meanwhile) {
      return meanwhile
    }
    throw error
  }
}
