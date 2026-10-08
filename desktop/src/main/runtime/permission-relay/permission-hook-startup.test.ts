import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { approveCodexPermissionHook } from './permission-codex-trust'
import { installPermissionHooks } from './permission-hook-install'
import { installPermissionRelayHooks } from './permission-hook-startup'

vi.mock('./permission-codex-trust', () => ({ approveCodexPermissionHook: vi.fn() }))
vi.mock('./permission-hook-install', () => ({ installPermissionHooks: vi.fn() }))

describe('permission hook startup isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(approveCodexPermissionHook).mockResolvedValue({ status: 'trusted' })
  })
  afterEach(() => vi.restoreAllMocks())

  it('can trust the installed Codex gate even when another provider configuration fails', async () => {
    vi.mocked(installPermissionHooks).mockReturnValue({
      installed: ['codex', 'agy'],
      failures: [{ provider: 'claude', code: 'config_invalid' }]
    })
    await installPermissionRelayHooks('nash')
    expect(installPermissionHooks).toHaveBeenCalledWith('nash')
    expect(approveCodexPermissionHook).toHaveBeenCalledOnce()
    expect(console.warn).toHaveBeenCalledWith(
      '[permission-relay] Hook installation deferred:',
      'claude',
      'config_invalid'
    )
  })

  it('never trusts a Codex gate that failed installation', async () => {
    vi.mocked(installPermissionHooks).mockReturnValue({
      installed: ['claude'],
      failures: [{ provider: 'codex', code: 'config_changed' }]
    })
    await installPermissionRelayHooks('nash')
    expect(approveCodexPermissionHook).not.toHaveBeenCalled()
  })

  it('reports the fixed reason when vendor hook trust requires native approval', async () => {
    vi.mocked(installPermissionHooks).mockReturnValue({ installed: ['codex'], failures: [] })
    vi.mocked(approveCodexPermissionHook).mockResolvedValue({
      status: 'native_approval_required',
      reason: 'unsupported'
    })
    await installPermissionRelayHooks('nash')
    expect(console.warn).toHaveBeenCalledWith(
      '[permission-relay] Codex hook requires native approval:',
      'unsupported'
    )
  })

  it('contains unexpected integration errors without logging provider data', async () => {
    vi.mocked(installPermissionHooks).mockImplementation(() => {
      throw new Error('private data')
    })
    await expect(installPermissionRelayHooks('nash')).resolves.toBeUndefined()
    expect(approveCodexPermissionHook).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalledWith(
      '[permission-relay] Hook integration unavailable; native approval remains active.'
    )
  })
})
