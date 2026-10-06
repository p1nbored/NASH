// Worker stages the app writes for attempts it runs. Orca keeps `stage` as free text beside the worker
// state, and nothing in Orca reads these values, so they only carry the app's own phase to readers.
export const APP_ATTEMPT_STAGES = {
  executorRunning: 'executor_running',
  /** The executor claimed it is done; the task waits, blocked, until a validator decides. */
  validationPending: 'validation_pending',
  /** Validators could not decide; the user or dot resolves it, never the primary. */
  validationInconclusive: 'validation_inconclusive',
  startFailed: 'start_failed',
  startOutcomeUnknown: 'start_outcome_unknown',
  executorFailed: 'executor_failed',
  executorBlocked: 'executor_blocked',
  // Orca's own names for a stop, so a stop settled here reads like one settled by Orca.
  stopRequested: 'stop_requested',
  processStopped: 'process_stopped',
  stopOutcomeUnknown: 'stop_outcome_unknown',
  settled: 'settled'
} as const

export const APP_ATTEMPT_AWAITING_VALIDATION_STAGES: readonly string[] = [
  APP_ATTEMPT_STAGES.validationPending,
  APP_ATTEMPT_STAGES.validationInconclusive
]
