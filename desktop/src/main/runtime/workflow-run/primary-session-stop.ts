import type { OrchestrationDb } from '../orchestration/db'
import { ReasonCodeSchema } from '../orchestration/db/autopilot-store-input'
import {
  getPrimarySessionStore,
  type PrimarySessionRecord
} from '../orchestration/db/primary-session-store'
import { moveOwner } from './primary-session-moves'
import {
  clockTimestamp,
  errorCodeOf,
  type PrimarySessionClock,
  type PrimaryTerminalPort
} from './primary-session-ports'
import { releaseEndedPrimaryBinding } from './primary-session-run-binding'
import { resolvePrimaryHandle } from './primary-session-status'

/** How long the interrupted session gets to wind down before its pane is closed. */
export const PRIMARY_STOP_GRACE_MS = 5_000

export type PrimarySessionStopResult =
  | {
      readonly outcome: 'stopped' | 'stop_unconfirmed'
      readonly owner: PrimarySessionRecord
    }
  | {
      readonly outcome: 'refused'
      readonly code: string
      readonly owner: PrimarySessionRecord | null
    }

export type PrimarySessionStopperDeps = {
  readonly db: OrchestrationDb
  readonly terminal: Pick<
    PrimaryTerminalPort,
    | 'getTerminalProcessIncarnation'
    | 'getTerminalHandleForPaneKey'
    | 'sendTerminal'
    | 'closeTerminal'
  >
  readonly clock: PrimarySessionClock
  readonly exitWatches?: {
    cancel(ownerId: string): void
    watch(owner: PrimarySessionRecord): void
  }
}

const WATCHED_STATES: ReadonlySet<string> = new Set(['running', 'unverifiable'])

function refused(code: string, owner: PrimarySessionRecord | null): PrimarySessionStopResult {
  return { outcome: 'refused', code, owner }
}

/** Interrupt, wait, close: only for a pane whose process identity still matches the owner record. */
export function createPrimarySessionStopper(deps: PrimarySessionStopperDeps) {
  const { db, terminal, clock } = deps
  const now = () => clockTimestamp(clock)

  async function closeConfirmed(handle: string): Promise<boolean> {
    try {
      const close = await terminal.closeTerminal(handle)
      return close.ptyKilled && close.ptyStopVerdict === undefined
    } catch {
      return false
    }
  }

  /** A stop that leaves the owner live (unconfirmed, or failed midway) watches it for an exit again. */
  function rearmIfLive(ownerId: string): void {
    try {
      const current = getPrimarySessionStore(db).get(ownerId)
      if (current && WATCHED_STATES.has(current.state)) {
        deps.exitWatches?.watch(current)
      }
    } catch (error) {
      console.warn(`[primary-session] the exit watch was not re-armed: ${errorCodeOf(error)}`)
    }
  }

  async function interruptAndClose(
    owner: PrimarySessionRecord,
    handle: string,
    reason: string
  ): Promise<PrimarySessionStopResult> {
    moveOwner(db, owner.ownerId, 'stopping', null, now())
    try {
      await terminal.sendTerminal(handle, { interrupt: true }, { inputKind: 'driving' })
    } catch {
      // The close below still ends the session; an unwritable pane is not a reason to keep it.
    }
    await clock.sleep(PRIMARY_STOP_GRACE_MS)
    if (await closeConfirmed(handle)) {
      const stopped = moveOwner(db, owner.ownerId, 'stopped', reason, now()) ?? owner
      releaseEndedPrimaryBinding(db, stopped)
      return { outcome: 'stopped', owner: stopped }
    }
    const unconfirmed =
      moveOwner(db, owner.ownerId, 'unverifiable', 'stop_unconfirmed', now()) ?? owner
    return { outcome: 'stop_unconfirmed', owner: unconfirmed }
  }

  async function stopOwner(
    owner: PrimarySessionRecord,
    reason: string
  ): Promise<PrimarySessionStopResult> {
    if (!ReasonCodeSchema.safeParse(reason).success) {
      return refused('autopilot_invalid_reason', owner)
    }
    if (owner.state === 'starting') {
      return refused('autopilot_owner_starting', owner)
    }
    if (owner.state !== 'running' && owner.state !== 'unverifiable') {
      return refused('autopilot_owner_not_live', owner)
    }
    const resolved = resolvePrimaryHandle(terminal, owner)
    if (!resolved.ok) {
      return refused('autopilot_owner_identity_unverified', owner)
    }
    // Why: our own close is a stop, not an exit; the watch must not record it as one.
    deps.exitWatches?.cancel(owner.ownerId)
    try {
      return await interruptAndClose(owner, resolved.handle, reason)
    } finally {
      rearmIfLive(owner.ownerId)
    }
  }

  return {
    stopOwner,
    /** Stops the run's live primary; `reason` is a code recorded on the owner. */
    async stop(runId: string, reason: string): Promise<PrimarySessionStopResult> {
      const owner = getPrimarySessionStore(db).findLiveByRun(runId)
      return owner ? stopOwner(owner, reason) : refused('autopilot_owner_not_live', null)
    }
  }
}
