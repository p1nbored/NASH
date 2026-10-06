import { describe, expect, it } from 'vitest'
import { normalizeClaudeAccountSelectionTarget } from './runtime-selection'

describe('normalizeClaudeAccountSelectionTarget', () => {
  it('defaults to the host and drops a stray distro there', () => {
    expect(normalizeClaudeAccountSelectionTarget()).toEqual({ runtime: 'host', wslDistro: null })
    expect(normalizeClaudeAccountSelectionTarget(null)).toEqual({
      runtime: 'host',
      wslDistro: null
    })
    expect(normalizeClaudeAccountSelectionTarget({ runtime: 'host', wslDistro: 'Ubuntu' })).toEqual(
      {
        runtime: 'host',
        wslDistro: null
      }
    )
  })

  it('trims a WSL distro and treats a blank one as the default distro', () => {
    expect(
      normalizeClaudeAccountSelectionTarget({ runtime: 'wsl', wslDistro: ' Ubuntu ' })
    ).toEqual({
      runtime: 'wsl',
      wslDistro: 'Ubuntu'
    })
    expect(normalizeClaudeAccountSelectionTarget({ runtime: 'wsl', wslDistro: '   ' })).toEqual({
      runtime: 'wsl',
      wslDistro: null
    })
    expect(normalizeClaudeAccountSelectionTarget({ runtime: 'wsl' })).toEqual({
      runtime: 'wsl',
      wslDistro: null
    })
  })
})
