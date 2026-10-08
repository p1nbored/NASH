import { approveCodexPermissionHook } from './permission-codex-trust'
import { installPermissionHooks } from './permission-hook-install'

/** Optional provider integration must not stop the runtime or hide its native approval UI. */
export async function installPermissionRelayHooks(cliCommand: string): Promise<void> {
  try {
    const result = installPermissionHooks(cliCommand)
    for (const failure of result.failures) {
      console.warn('[permission-relay] Hook installation deferred:', failure.provider, failure.code)
    }
    if (result.installed.includes('codex')) {
      const trust = await approveCodexPermissionHook()
      if (trust.status === 'native_approval_required') {
        console.warn('[permission-relay] Codex hook requires native approval:', trust.reason)
      }
    }
  } catch {
    console.warn('[permission-relay] Hook integration unavailable; native approval remains active.')
  }
}
