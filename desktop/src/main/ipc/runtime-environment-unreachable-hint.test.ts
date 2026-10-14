import { describe, expect, it } from 'vitest'
import { withRuntimeUnreachableHint } from './runtime-environment-unreachable-hint'

const UNREACHABLE = 'Could not connect to the remote Orca runtime at ws://127.0.0.1:42000.'

describe('withRuntimeUnreachableHint', () => {
  it('points a WSL host at its own reconnect, never at Tailscale', () => {
    const message = withRuntimeUnreachableHint(
      { orcadDeployment: { kind: 'wsl', distro: 'Ubuntu', localPort: 42000, remotePort: 6768 } },
      UNREACHABLE,
      'ws://127.0.0.1:42000'
    )
    expect(message).not.toMatch(/tailscale/i)
    expect(message).toContain('The Orca server in the WSL distro Ubuntu isn’t answering')
  })

  it('keeps the Tailscale hint for a network server', () => {
    expect(withRuntimeUnreachableHint({}, UNREACHABLE, 'ws://203.0.113.4:6768')).toMatch(
      /tailscale/i
    )
  })

  it('leaves other failures alone', () => {
    const wsl = {
      orcadDeployment: { kind: 'wsl' as const, distro: 'Ubuntu', localPort: 1, remotePort: 2 }
    }
    expect(withRuntimeUnreachableHint(wsl, 'Unauthorized', null)).toBe('Unauthorized')
  })
})
