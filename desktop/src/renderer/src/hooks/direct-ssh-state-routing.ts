import type { DirectSshAuthority, SshConnectionState } from '../../../shared/ssh-types'

export type DirectSshConnectedStateOrigin = 'push' | 'initial-hydration'

export function directSshAuthorityFromConnectionState(
  targetId: string,
  state: SshConnectionState
): DirectSshAuthority | null {
  if (
    state.targetId !== targetId ||
    state.status !== 'connected' ||
    !state.providerEpoch ||
    state.connectionGeneration === undefined
  ) {
    return null
  }
  return {
    targetId,
    providerEpoch: state.providerEpoch,
    connectionGeneration: state.connectionGeneration
  }
}

export function registerDirectSshWakeRouting(deps: {
  getConnectionStates: () => Iterable<readonly [string, SshConnectionState]>
  wakeAuthority: (authority: DirectSshAuthority) => void
  onSystemResumed?: (callback: () => void) => () => void
}): () => void {
  let stopped = false
  const wake = (): void => {
    if (stopped) {
      return
    }
    for (const [targetId, state] of deps.getConnectionStates()) {
      const authority = directSshAuthorityFromConnectionState(targetId, state)
      if (authority) {
        deps.wakeAuthority(authority)
      }
    }
  }
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('online', wake)
  }
  const unsubscribeSystemResumed = deps.onSystemResumed?.(wake)
  return () => {
    if (stopped) {
      return
    }
    stopped = true
    if (typeof window.removeEventListener === 'function') {
      window.removeEventListener('online', wake)
    }
    unsubscribeSystemResumed?.()
  }
}
