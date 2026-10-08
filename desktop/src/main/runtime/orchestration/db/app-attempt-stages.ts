// Worker stages the app writes for attempts it runs. Orca keeps `stage` as free text beside the worker
// state, and nothing in Orca reads these values, so they only carry the app's own phase to readers.
export const APP_ATTEMPT_STAGES = {
  executorRunning: 'executor_running',
  /** The executor claimed it is done; the task waits, blocked, until a validator decides. */
  validationPending: 'validation_pending',
  /** Validators could not decide; the user or dot resolves it, never the primary. */
  validationInconclusive: 'validation_inconclusive',
  startFailed: 'start_failed',
  executorFailed: 'executor_failed',
  settled: 'settled'
} as const

export const APP_ATTEMPT_AWAITING_VALIDATION_STAGES: readonly string[] = [
  APP_ATTEMPT_STAGES.validationPending,
  APP_ATTEMPT_STAGES.validationInconclusive
]
