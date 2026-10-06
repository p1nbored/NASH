import type { OrcaRuntimeService } from '../../../../orca-runtime'
import { OrchestrationError } from '../../../../orchestration/orchestration-error'
import {
  getTaskClassificationRuntime,
  type TaskClassificationRuntime
} from '../../../../task-classification/classification-runtime'
import type { TaskExecutionRuntime } from '../../../../task-execution/task-execution-runtime'

/** Every refusal of the agent-facing task API; each one applies no effects. */
export const AUTOPILOT_TASK_API_ERROR_CODES = {
  unavailable: 'autopilot_task_api_unavailable',
  callerRefused: 'autopilot_task_caller_refused',
  specRefused: 'autopilot_task_spec_refused',
  specTooLarge: 'autopilot_task_spec_too_large',
  taskNotInRun: 'autopilot_task_not_in_run',
  attemptMismatch: 'autopilot_report_attempt_mismatch',
  reportNotInSession: 'autopilot_report_not_in_session',
  summaryRefused: 'autopilot_summary_refused',
  tasksUnsettled: 'autopilot_run_tasks_unsettled'
} as const

export type AutopilotClassifierPort = Pick<TaskClassificationRuntime, 'classify' | 'pending'>

/** A claim that is now durable and waits for its validators. */
export type AutopilotClaim = { runId: string; taskId: string; dispatchId: string }

/** A fixed event code plus ids; never error text, which can carry a path or a secret. */
export type AutopilotTaskApiLogEvent = {
  event:
    | 'classify_failed'
    | 'attempt_settle_rejected'
    | 'notice_announce_failed'
    | 'after_claim_failed'
    | 'after_run_completed_failed'
  runId?: string
  taskId?: string
  dispatchId?: string
  code?: string
}

/** What the startup wiring (package E1) binds; the RPC methods take the database from the runtime. */
export type AutopilotTaskApiPorts = {
  /** The execution service's start (task-execution); its view is returned, its settlement is not awaited. */
  readonly startTask: TaskExecutionRuntime['startTask']
  /** The bounded, masked executor result view, for task-show. */
  readonly readAttemptResult: TaskExecutionRuntime['readAttemptResult']
  /** Clef's TaskSpec classifier; defaults to the installed runtime, null while none is. */
  readonly classifier?: () => AutopilotClassifierPort | null
  /** Called once a claim committed; the wiring starts its validation (task-validation). */
  readonly afterClaim: (claim: AutopilotClaim) => void
  /** Called once a run completed, for example to stop its primary session or tell dot. */
  readonly afterRunCompleted?: (runId: string) => void
  /** The CLI command name the next-step hints spell, as the launch prompt does. */
  readonly cliCommand: string
  readonly now: () => number
  /** Test seam; production waits on a timer that the client's disconnect cancels. */
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  readonly log: (event: AutopilotTaskApiLogEvent) => void
}

export type AutopilotTaskApi = Required<Omit<AutopilotTaskApiPorts, 'afterRunCompleted'>> &
  Pick<AutopilotTaskApiPorts, 'afterRunCompleted'>

const apis = new WeakMap<OrcaRuntimeService, AutopilotTaskApi>()

/** The English refusal every D1 error carries: a stable code, and no effects applied. */
export function autopilotRefusal(
  code: string,
  message: string,
  data: Readonly<Record<string, unknown>> = {}
): OrchestrationError {
  return new OrchestrationError(code, `${message} No effects were applied.`, {
    effectsApplied: false,
    ...data
  })
}

function sleepUnlessAborted(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(done, ms)
    function done(): void {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    signal?.addEventListener('abort', done, { once: true })
  })
}

/** Called once at wiring time; returns the unregister. A second API for one runtime is a wiring bug. */
export function registerAutopilotTaskApi(
  runtime: OrcaRuntimeService,
  ports: AutopilotTaskApiPorts
): () => void {
  if (apis.has(runtime)) {
    throw new Error('An autopilot task API is already registered for this runtime.')
  }
  const api: AutopilotTaskApi = {
    ...ports,
    classifier: ports.classifier ?? getTaskClassificationRuntime,
    sleep: ports.sleep ?? sleepUnlessAborted
  }
  apis.set(runtime, api)
  return () => {
    if (apis.get(runtime) === api) {
      apis.delete(runtime)
    }
  }
}

/** Until the wiring registers the API every task command refuses, so nothing runs half-wired. */
export function requireAutopilotTaskApi(runtime: OrcaRuntimeService): AutopilotTaskApi {
  const api = apis.get(runtime)
  if (!api) {
    throw autopilotRefusal(
      AUTOPILOT_TASK_API_ERROR_CODES.unavailable,
      'The task service of this app is not running.'
    )
  }
  return api
}

export function errorCodeOf(error: unknown): string {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code.slice(0, 64)
    : 'unknown'
}

/** Runs a post-commit hook; a failure is logged by code only, because the effect is already durable. */
export function runAfterCommit(
  api: AutopilotTaskApi,
  hook: () => void,
  event: Omit<AutopilotTaskApiLogEvent, 'code'>
): void {
  try {
    hook()
  } catch (error) {
    api.log({ ...event, code: errorCodeOf(error) })
  }
}
