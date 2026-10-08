import { describe, expect, it } from 'vitest'
import { permissionHookConfig } from './permission-hook-install'

describe('managed CLI permission hooks', () => {
  it.each(['claude', 'codex', 'agy'] as const)(
    'installs one %s gate while preserving user hooks',
    (provider) => {
      const user = {
        hooks: { Stop: [{ hooks: [{ type: 'command', command: 'user-stop' }] }] },
        custom: 'keep'
      }
      const installed = permissionHookConfig(user, provider, 'nash')
      expect(installed.custom).toBe('keep')
      expect(installed.hooks?.Stop).toEqual(user.hooks.Stop)
      expect(JSON.stringify(installed)).toContain(
        `nash orchestration permission-request --provider ${provider}`
      )
      expect(permissionHookConfig(installed, provider, 'nash')).toEqual(installed)
      expect(user).not.toHaveProperty('nash-permission-relay')
    }
  )
  it('refuses malformed hook collections instead of overwriting them', () => {
    expect(() => permissionHookConfig({ hooks: 'broken' }, 'codex', 'nash')).toThrow()
  })
})
