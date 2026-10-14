// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import type { DirectSshAuthority, SshProviderEpoch } from '../../../shared/ssh-types'
import {
  directSshAuthorityFromConnectionState,
  registerDirectSshWakeRouting
} from './direct-ssh-state-routing'

function authority(epoch = 'epoch-a'): DirectSshAuthority {
  return {
    targetId: 'target-a',
    providerEpoch: epoch as SshProviderEpoch,
    connectionGeneration: 1
  }
}

describe('registerDirectSshWakeRouting', () => {
  it('wakes only complete connected direct authorities and removes both listeners', () => {
    const wakeAuthority = vi.fn()
    let resume: (() => void) | undefined
    const unsubscribeSystemResumed = vi.fn()
    const stop = registerDirectSshWakeRouting({
      getConnectionStates: () =>
        new Map([
          [
            'target-a',
            {
              ...authority(),
              status: 'connected' as const,
              error: null,
              reconnectAttempt: 0
            }
          ],
          [
            'target-partial',
            {
              targetId: 'target-partial',
              status: 'connected' as const,
              error: null,
              reconnectAttempt: 0,
              providerEpoch: 'partial' as SshProviderEpoch
            }
          ],
          [
            'target-disconnected',
            {
              ...authority('disconnected'),
              targetId: 'target-disconnected',
              status: 'disconnected' as const,
              error: null,
              reconnectAttempt: 0
            }
          ]
        ]),
      wakeAuthority,
      onSystemResumed: (callback) => {
        resume = callback
        return unsubscribeSystemResumed
      }
    })

    window.dispatchEvent(new Event('online'))
    resume?.()

    expect(wakeAuthority).toHaveBeenCalledTimes(2)
    expect(wakeAuthority).toHaveBeenNthCalledWith(1, authority())
    expect(wakeAuthority).toHaveBeenNthCalledWith(2, authority())

    stop()
    stop()
    window.dispatchEvent(new Event('online'))
    resume?.()
    expect(unsubscribeSystemResumed).toHaveBeenCalledOnce()
    expect(wakeAuthority).toHaveBeenCalledTimes(2)
  })

  it('rejects mismatched keys and malformed partial authority', () => {
    expect(
      directSshAuthorityFromConnectionState('other-target', {
        ...authority(),
        status: 'connected',
        error: null,
        reconnectAttempt: 0
      })
    ).toBeNull()
    expect(
      directSshAuthorityFromConnectionState('target-a', {
        targetId: 'target-a',
        status: 'connected',
        error: null,
        reconnectAttempt: 0,
        connectionGeneration: 1
      })
    ).toBeNull()
  })
})
