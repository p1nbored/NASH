import type { OrchestrationDb } from '../orchestration/db'
import {
  getPrimarySessionStore,
  type PrimarySessionRecord
} from '../orchestration/db/primary-session-store'
import { getWorkflowRunStore } from '../orchestration/db/workflow-run-store'
import { moveOwner, moveWorkflowRun } from './primary-session-moves'
import {
  clockTimestamp,
  errorCodeOf,
  type PrimarySessionClock,
  type PrimaryTerminalPort
} from './primary-session-ports'
import { releaseEndedPrimaryBinding } from './primary-session-run-binding'
import { resolvePrimaryHandle } from './primary-session-status'

export type PrimarySessionExitWatchDeps = {
  readonly db: OrchestrationDb
  readonly terminal: Pick<
    PrimaryTerminalPort,
    'waitForTerminal' | 'getTerminalProcessIncarnation' | 'getTerminalHandleForPaneKey'
  >
  readonly clock: Pick<PrimarySessionClock, 'now' | 'sleep'>
}

export type PrimarySessionExitWatches = {
  watch(owner: PrimarySessionRecord): void
  cancel(ownerId: string): void
  cancelAll(): void
  /** Resolves when the owner's watch has finished (immediately when there is none). */
  settled(ownerId: string): Promise<void>
}

type Watch = { readonly controller: AbortController; readonly done: Promise<void> }

const WATCHED_STATES: ReadonlySet<string> = new Set(['running', 'unverifiable'])
const RUN_STATUSES_ENDED_BY_EXIT: ReadonlySet<string> = new Set(['launching', 'active'])
export const PRIMARY_EXIT_REASON = 'primary_exited'
const EXIT_REASON = PRIMARY_EXIT_REASON

/** The waits before each new try at recording an observed exit, while its watch lives. */
const PRIMARY_EXIT_RECORD_RETRY_MS: readonly number[] = [1_000, 5_000, 30_000]

// Why the code only: an error message may name a path.
function reportExitRecord(code: string): void {
  console.warn(`[primary-session] an observed exit was not recorded: ${code}`)
}

/**
 * `exited` only from a satisfied exit wait on the pane that still carries the recorded process
 * incarnation; a failed or unsatisfied wait is lost contact and changes nothing.
 */
export function createPrimarySessionExitWatches(
  deps: PrimarySessionExitWatchDeps
): PrimarySessionExitWatches {
  const { db, terminal } = deps
  const watches = new Map<string, Watch>()

  /** Compare-and-set moves only, so a later try finishes what an earlier failed try left. */
  function recordExit(watched: PrimarySessionRecord): void {
    // The wait was bound to the handle of the recorded incarnation, so its exit is this owner's exit.
    const current = getPrimarySessionStore(db).get(watched.ownerId)
    const recordedBefore = current?.state === 'exited' && current.endReason === EXIT_REASON
    if (!current || (!WATCHED_STATES.has(current.state) && !recordedBefore)) {
      return
    }
    const timestamp = clockTimestamp(deps.clock)
    const exited = recordedBefore
      ? current
      : moveOwner(db, current.ownerId, 'exited', EXIT_REASON, timestamp)
    const run = getWorkflowRunStore(db).get(current.runId)
    if (run && RUN_STATUSES_ENDED_BY_EXIT.has(run.status)) {
      moveWorkflowRun(db, run.runId, 'failed', EXIT_REASON, timestamp)
    }
    if (exited) {
      releaseEndedPrimaryBinding(db, exited)
    }
  }

  function tryRecordExit(owner: PrimarySessionRecord): boolean {
    try {
      recordExit(owner)
      return true
    } catch (error) {
      reportExitRecord(errorCodeOf(error))
      return false
    }
  }

  /** Tried again, so a passing store failure does not leave the run active on a dead primary. */
  async function recordExitWithRetry(
    owner: PrimarySessionRecord,
    signal: AbortSignal
  ): Promise<void> {
    if (tryRecordExit(owner)) {
      return
    }
    for (const delay of PRIMARY_EXIT_RECORD_RETRY_MS) {
      await deps.clock.sleep(delay)
      if (signal.aborted || tryRecordExit(owner)) {
        return
      }
    }
    reportExitRecord('primary_exit_unrecorded')
  }

  async function observe(
    owner: PrimarySessionRecord,
    handle: string,
    signal: AbortSignal
  ): Promise<void> {
    // A failed wait is lost contact, never an exit.
    const result = await terminal
      .waitForTerminal(handle, { condition: 'exit', signal })
      .catch(() => null)
    if (result !== null && !signal.aborted && result.satisfied) {
      await recordExitWithRetry(owner, signal)
    }
  }

  return {
    watch(owner) {
      if (watches.has(owner.ownerId) || !WATCHED_STATES.has(owner.state)) {
        return
      }
      const resolved = resolvePrimaryHandle(terminal, owner)
      if (!resolved.ok) {
        return
      }
      const controller = new AbortController()
      const done = observe(owner, resolved.handle, controller.signal)
        .catch((error: unknown) => reportExitRecord(errorCodeOf(error)))
        .finally(() => {
          if (watches.get(owner.ownerId)?.controller === controller) {
            watches.delete(owner.ownerId)
          }
        })
      watches.set(owner.ownerId, { controller, done })
    },
    cancel(ownerId) {
      watches.get(ownerId)?.controller.abort()
      watches.delete(ownerId)
    },
    cancelAll() {
      for (const watch of watches.values()) {
        watch.controller.abort()
      }
      watches.clear()
    },
    settled: (ownerId) => watches.get(ownerId)?.done ?? Promise.resolve()
  }
}
