import {
  getRuntimeSshAccess,
  type KnownRuntimeEnvironment
} from '../../shared/runtime-environments'

/**
 * Hosts whose credential prompt the user cancelled (or left unanswered). Until the user explicitly
 * connects again, no automatic connect may prompt for them: background status checks, managed
 * server tunnels and reconnect ladders would otherwise reopen the modal every few seconds.
 */
// The value is the declining attempt's credential signal: that attempt may still offer its other
// methods (a password after a cancelled passphrase), only later attempts are barred.
const declinedTargets = new Map<string, AbortSignal | undefined>()

export function recordSshCredentialDeclined(targetId: string, attempt?: AbortSignal): void {
  declinedTargets.set(targetId, attempt)
}

/** Omit `attempt` to ask whether a new connect may be started at all. */
export function isSshCredentialDeclined(targetId: string, attempt?: AbortSignal): boolean {
  if (!declinedTargets.has(targetId)) {
    return false
  }
  return attempt === undefined || declinedTargets.get(targetId) !== attempt
}

/** Only an explicit user connect, or a sign-in that succeeded anyway, may lift a decline. */
export function clearSshCredentialDeclined(targetId: string): void {
  declinedTargets.delete(targetId)
}

/** An explicit connect to a server reached over SSH is a sign-in to that SSH host too. */
export function clearSshCredentialDeclinedForEnvironment(
  environment: Pick<KnownRuntimeEnvironment, 'orcadDeployment' | 'sshAccess'>
): void {
  const targetId = getRuntimeSshAccess(environment)?.sshTargetId
  if (targetId) {
    clearSshCredentialDeclined(targetId)
  }
}

export function resetSshCredentialDeclinesForTests(): void {
  declinedTargets.clear()
}

/** Classified as an auth failure, so callers report "needs sign-in" and never retry it as transient. */
export function createSshCredentialDeclinedError(label: string): Error {
  return Object.assign(
    new Error(`SSH sign-in for ${label} was cancelled. Reconnect to sign in again.`),
    { level: 'client-authentication' }
  )
}
