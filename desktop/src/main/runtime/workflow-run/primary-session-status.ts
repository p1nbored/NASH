import type {
  PrimarySessionRecord,
  PrimarySessionStore
} from '../orchestration/db/primary-session-store'
import { readAgentDialogState } from '../permission-relay/permission-terminal-observer'
import type { PrimaryTerminalPort } from './primary-session-ports'

/** What the main agent in the primary pane is doing, from Orca's status store. */
export type PrimaryAgentActivity = 'working' | 'dialog_open' | 'idle' | 'unknown'

export type PrimarySessionUnverifiableReason =
  | 'handle_unresolved'
  | 'incarnation_mismatch'
  | 'status_unreadable'

export type PrimarySessionStatus =
  | { readonly kind: 'live'; readonly handle: string; readonly activity: PrimaryAgentActivity }
  /** The recorded pane is ours, but no agent runs in it any more; not proof the process exited. */
  | { readonly kind: 'agent_absent'; readonly handle: string }
  /** Loss of contact or a changed pane: never read as exited (ssh-execution-boundary.md). */
  | { readonly kind: 'unverifiable'; readonly reason: PrimarySessionUnverifiableReason }
  | { readonly kind: 'starting' }
  | { readonly kind: 'ended'; readonly state: 'stopped' | 'exited' }

export type PrimaryStatusPort = Pick<
  PrimaryTerminalPort,
  'getTerminalAgentStatus' | 'getTerminalProcessIncarnation' | 'getTerminalHandleForPaneKey'
>

type HandleResolution =
  | { readonly ok: true; readonly handle: string }
  | { readonly ok: false; readonly reason: 'handle_unresolved' | 'incarnation_mismatch' }

/**
 * The stored handle first, then a fresh one for the pane key; either must carry the recorded process
 * incarnation, so a reused pane or a respawned shell is never taken for the primary.
 */
export function resolvePrimaryHandle(
  terminal: Pick<
    PrimaryStatusPort,
    'getTerminalProcessIncarnation' | 'getTerminalHandleForPaneKey'
  >,
  owner: PrimarySessionRecord
): HandleResolution {
  if (owner.paneKey === null || owner.processIncarnation === null) {
    return { ok: false, reason: 'handle_unresolved' }
  }
  const candidates = [owner.terminalHandle, terminal.getTerminalHandleForPaneKey(owner.paneKey)]
  let sawHandle = false
  for (const handle of candidates) {
    if (handle === null) {
      continue
    }
    const incarnation = terminal.getTerminalProcessIncarnation(handle)
    if (incarnation === null) {
      continue
    }
    sawHandle = true
    if (incarnation === owner.processIncarnation) {
      return { ok: true, handle }
    }
  }
  return { ok: false, reason: sawHandle ? 'incarnation_mismatch' : 'handle_unresolved' }
}

function activityWithoutDialog(
  status: 'working' | 'permission' | 'idle' | null
): PrimaryAgentActivity {
  return status === 'working' || status === 'idle' ? status : 'unknown'
}

/** Reads only: nothing is written, and only positive evidence from the pane's host counts. */
export async function readPrimarySessionStatus(
  terminal: PrimaryStatusPort,
  owner: PrimarySessionRecord
): Promise<PrimarySessionStatus> {
  if (owner.state === 'stopped' || owner.state === 'exited') {
    return { kind: 'ended', state: owner.state }
  }
  if (owner.state === 'starting') {
    return { kind: 'starting' }
  }
  const resolved = resolvePrimaryHandle(terminal, owner)
  if (!resolved.ok) {
    return { kind: 'unverifiable', reason: resolved.reason }
  }
  let status
  try {
    status = await terminal.getTerminalAgentStatus(resolved.handle)
  } catch {
    return { kind: 'unverifiable', reason: 'status_unreadable' }
  }
  // D2's dialog read over the same status: Orca maps the hook store's `waiting` and `blocked` rows
  // (permission and question dialogs) to `permission`, which D2 reads as an open dialog.
  const read = status
  const dialog = await readAgentDialogState(async () => read, resolved.handle)
  if (dialog === 'unknown') {
    return { kind: 'agent_absent', handle: resolved.handle }
  }
  return {
    kind: 'live',
    handle: resolved.handle,
    activity: dialog === 'open' ? 'dialog_open' : activityWithoutDialog(status.status)
  }
}

/** The dialog gate D-019 needs: a permission or question dialog is open in the primary pane. */
export function isPrimaryDialogOpen(status: PrimarySessionStatus): boolean {
  return status.kind === 'live' && status.activity === 'dialog_open'
}

/** A verified read of an unverifiable owner proves the same process again, so it runs again. */
export function promoteVerifiedOwner(
  sessions: Pick<PrimarySessionStore, 'transition'>,
  owner: PrimarySessionRecord,
  status: PrimarySessionStatus,
  timestamp: string
): PrimarySessionRecord {
  const verified = status.kind === 'live' || status.kind === 'agent_absent'
  if (owner.state !== 'unverifiable' || !verified) {
    return owner
  }
  return sessions.transition({
    ownerId: owner.ownerId,
    from: 'unverifiable',
    to: 'running',
    reason: null,
    timestamp
  })
}
