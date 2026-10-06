import {
  WORKBENCH_VALIDATION_ERROR_CODES,
  type WorkbenchValidationCheckPendingResult
} from '../../../shared/rpc-contract/workbench-validation-params'
import type { OrcaRuntimeService } from '../orca-runtime'
import { OrchestrationError } from '../orchestration/orchestration-error'
import type { ValidationRunReport } from './validation-runner'

/**
 * The desktop's "Check now": one pass over the attempts still waiting for a verdict, through the
 * same one-at-a-time queue as every other validation. Startup registers it once validation is up.
 */
export type ValidationBacklogPort = {
  checkBacklog(): Promise<WorkbenchValidationCheckPendingResult>
}

const portByRuntime = new WeakMap<OrcaRuntimeService, ValidationBacklogPort>()

/** Returns the unregister. A second port for one runtime is a wiring bug. */
export function registerValidationBacklogPort(
  runtime: OrcaRuntimeService,
  port: ValidationBacklogPort
): () => void {
  if (portByRuntime.has(runtime)) {
    throw new Error('A validation backlog port is already registered for this runtime.')
  }
  portByRuntime.set(runtime, port)
  return () => {
    if (portByRuntime.get(runtime) === port) {
      portByRuntime.delete(runtime)
    }
  }
}

export function validationUnavailable(): OrchestrationError {
  return new OrchestrationError(
    WORKBENCH_VALIDATION_ERROR_CODES.unavailable,
    'Task validation is not available in this session.'
  )
}

export function validationPassRunning(): OrchestrationError {
  return new OrchestrationError(
    WORKBENCH_VALIDATION_ERROR_CODES.passRunning,
    'A validation pass is already running. Check again when it finishes.'
  )
}

/** Fixed text: the runner's error can carry a path, so only its code goes to the app log. */
export function validationPassFailed(): OrchestrationError {
  return new OrchestrationError(
    WORKBENCH_VALIDATION_ERROR_CODES.passFailed,
    'The validation pass failed before it finished. The app log has its error code.'
  )
}

/** Until validation is installed (or once the app quits) the desktop's check refuses, never guesses. */
export function requireValidationBacklogPort(runtime: OrcaRuntimeService): ValidationBacklogPort {
  const port = portByRuntime.get(runtime)
  if (!port) {
    throw validationUnavailable()
  }
  return port
}

/** Counts by outcome only, so no task text, verdict note or path leaves the runtime. */
export function summarizeValidationPass(
  reports: readonly ValidationRunReport[]
): WorkbenchValidationCheckPendingResult {
  const verdictCount = (verdict: 'pass' | 'fail' | 'inconclusive'): number =>
    reports.filter((report) => report.outcome === 'settled' && report.verdict === verdict).length
  return {
    checked: reports.length,
    passed: verdictCount('pass'),
    failed: verdictCount('fail'),
    inconclusive: verdictCount('inconclusive'),
    skipped: reports.filter((report) => report.outcome === 'skipped').length
  }
}
