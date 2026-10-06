import type { PreloadApi } from '../../../src/preload/api-types'
import { getFallbackResult } from '../../../src/renderer/src/web/preload-api/web-fallback-api'
import { createWebAppApi } from '../../../src/renderer/src/web/preload-api/web-app-api'
import { createWebStarNagApi } from '../../../src/renderer/src/web/preload-api/web-star-nag-api'
import { createWebPlatformApi } from '../../../src/renderer/src/web/preload-api/web-platform-api'
import { createWebSettingsApi } from '../../../src/renderer/src/web/preload-api/web-settings-api'
import { createWebKeybindingsApi } from '../../../src/renderer/src/web/preload-api/web-keybindings-api'
import { createWebOnboardingApi } from '../../../src/renderer/src/web/preload-api/web-onboarding-api'
import { createWebWorkspaceSessionApi } from '../../../src/renderer/src/web/preload-api/web-workspace-session-api'
import { createWebAgentStatusApi } from '../../../src/renderer/src/web/preload-api/web-agent-status-api'
import { createWebUiApi } from '../../../src/renderer/src/web/preload-api/web-ui-api'
import { createUpdaterApi } from '../../../src/renderer/src/web/preload-api/web-updater-api'

const fallbackCounts = new Map<string, number>()

// Why record fallbacks: each unlisted method resolves to a neutral default; the
// log names which preload calls a scenario still needs to fixture.
function recordFallback(path: string[], args: unknown[]): unknown {
  const key = path.join('.')
  const count = (fallbackCounts.get(key) ?? 0) + 1
  fallbackCounts.set(key, count)
  if (count === 1 || count % 200 === 0) {
    console.debug(`[harness-fallback] ${key} x${count}`)
  }
  return getFallbackResult(path, args)
}

function fallbackProxy(path: string[]): never {
  const fn = (): undefined => undefined
  return new Proxy(fn, {
    get(_target, property) {
      if (property === 'then') {
        return undefined
      }
      return fallbackProxy([...path, String(property)])
    },
    apply(_target, _thisArg, args) {
      return recordFallback(path, args)
    }
  }) as never
}

function withRecordedFallback<T extends object>(target: T, path: string[]): T {
  return new Proxy(target, {
    get(current, property, receiver) {
      if (property in current) {
        // oxlint-disable-next-line anti-slop/no-reflect-get -- Proxy `get` trap forwarding the receiver.
        const value = Reflect.get(current, property, receiver) as unknown
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          return withRecordedFallback(value as object, [...path, String(property)])
        }
        return value
      }
      return fallbackProxy([...path, String(property)])
    }
  })
}

// Why reuse the web client's local-storage APIs: they already implement the
// settings/keybinding/onboarding/session contracts without a runtime host.
export function installFixtureApi(fixtures: Partial<PreloadApi> = {}): void {
  const api: Partial<PreloadApi> = {
    ...createWebAppApi(),
    ...createWebStarNagApi(),
    ...createWebPlatformApi(),
    ...createWebSettingsApi(),
    keybindings: createWebKeybindingsApi(),
    ui: createWebUiApi(),
    // Why: the generic fallback is not a valid UpdateStatus, so UpdateCard rendered an empty card.
    updater: createUpdaterApi(),
    ...createWebWorkspaceSessionApi(),
    ...createWebOnboardingApi(),
    ...createWebAgentStatusApi(),
    ...fixtures
  }
  window.api = withRecordedFallback(api, []) as PreloadApi
}
