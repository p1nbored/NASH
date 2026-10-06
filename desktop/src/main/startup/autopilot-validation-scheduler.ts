import {
  summarizeValidationPass,
  validationPassFailed,
  validationPassRunning,
  validationUnavailable,
  type ValidationBacklogPort
} from '../runtime/task-validation/validation-backlog-port'
import type {
  ValidationRunner,
  ValidationRunReport
} from '../runtime/task-validation/validation-runner'
import type { AutopilotRuntimeLog } from './autopilot-runtime-events'
import { installFailureCode } from './autopilot-install-runner'

// Validators decide completion (D-016). Each claim is validated as soon as it commits, one at a time
// so a sweep never re-opens a review another call is still deciding. Attempts a previous session left
// waiting are swept once, after the first claim of this session rather than at startup, because a
// model review may start a reviewer CLI and nothing live may start at startup. The desktop's
// "Check now" runs the same sweep on the same queue, one pass at a time.

export type ValidationScheduler = ValidationBacklogPort & {
  /** After a claim committed: an in-session task-report, or a process attempt that settled. */
  validateAttempt(dispatchId: string): void
  /** Will-quit: aborts the running validation and refuses new ones. */
  abort(): void
  /** Resolves once every queued validation has stopped. */
  drain(): Promise<void>
}

/** A queued job's answer; `ran: false` when the quit dropped it before it started. */
type Scheduled<T> = { readonly ran: true; readonly value: T } | { readonly ran: false }

export function createValidationScheduler(deps: {
  readonly runner: ValidationRunner
  readonly log: AutopilotRuntimeLog
}): ValidationScheduler {
  const controller = new AbortController()
  let tail: Promise<void> = Promise.resolve()
  let backlogSwept = false
  let backlogPass: Promise<unknown> | null = null

  function schedule<T>(
    job: (signal: AbortSignal) => Promise<T>,
    dispatchId?: string
  ): Promise<Scheduled<T>> {
    const result = tail.then(async (): Promise<Scheduled<T>> =>
      controller.signal.aborted
        ? { ran: false }
        : { ran: true, value: await job(controller.signal) }
    )
    // Why the code only: the error text can carry a path or a command line.
    void result.catch((error: unknown) =>
      deps.log({
        event: 'validation_failed',
        code: installFailureCode(error),
        ...(dispatchId ? { dispatchId } : {})
      })
    )
    tail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  function startBacklogPass(): Promise<Scheduled<ValidationRunReport[]>> {
    backlogSwept = true
    const pass = schedule((signal) => deps.runner.validatePending({ signal }))
    backlogPass = pass
    const clear = (): void => {
      if (backlogPass === pass) {
        backlogPass = null
      }
    }
    void pass.then(clear, clear)
    return pass
  }

  return {
    validateAttempt(dispatchId) {
      void schedule((signal) => deps.runner.validateAttempt(dispatchId, signal), dispatchId)
      if (!backlogSwept) {
        void startBacklogPass()
      }
    },
    async checkBacklog() {
      if (controller.signal.aborted) {
        throw validationUnavailable()
      }
      // Why refuse: a second pass would only queue behind the first and re-list the same attempts.
      if (backlogPass !== null) {
        throw validationPassRunning()
      }
      let outcome: Scheduled<ValidationRunReport[]>
      try {
        outcome = await startBacklogPass()
      } catch {
        throw validationPassFailed()
      }
      if (!outcome.ran) {
        throw validationUnavailable()
      }
      return summarizeValidationPass(outcome.value)
    },
    abort: () => controller.abort(),
    drain: () => tail
  }
}
