import { describe, expect, it } from 'vitest'
import { getSourceControlAiControllerDiscoveryHostKey } from './source-control/ai/use-ai'

describe('getSourceControlAiControllerDiscoveryHostKey', () => {
  it('keys generation settings by the active workspace connection', () => {
    const local = { kind: 'local' } as const

    expect(getSourceControlAiControllerDiscoveryHostKey(local, null)).toBe('local')
    expect(getSourceControlAiControllerDiscoveryHostKey(local, undefined)).toBe('unknown')
    expect(getSourceControlAiControllerDiscoveryHostKey(local, 'ssh-1')).toBe('ssh:ssh-1')
  })

  it('uses the repo owner runtime before SSH connection scope', () => {
    const owner = { kind: 'environment', environmentId: 'env-1' } as const

    expect(getSourceControlAiControllerDiscoveryHostKey(owner, 'ssh-1')).toBe('runtime:env-1')
  })
})
