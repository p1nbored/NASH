import type { PreloadApi } from '../../../src/preload/api-types'
import type { SkillDiscoveryResult } from '../../../src/shared/skills'
import type { RateLimitState } from '../../../src/shared/rate-limit-types'
import { createSkillsApi } from '../../../src/renderer/src/web/preload-api/web-host-capability-api'

// Why fixed timestamps: a changing scannedAt re-renders consumers on every read.
const FIXTURE_SCANNED_AT = Date.UTC(2026, 9, 3, 12, 0, 0)

const freshnessInventory = Object.freeze({
  schemaVersion: 1 as const,
  installations: [],
  eligibleUpdateNames: [],
  scanIssues: [],
  scannedAt: FIXTURE_SCANNED_AT
})

const rateLimits: RateLimitState = {
  claude: null,
  codex: null,
  gemini: null,
  opencodeGo: null,
  kimi: null,
  antigravity: null,
  minimax: null,
  grok: null,
  cursor: null,
  zcode: null,
  minimaxCookieConfigured: false,
  minimaxApiKeyConfigured: false,
  opencodeGoApiKeyConfigured: false,
  grokAuthConfigured: false,
  cursorAuthConfigured: false,
  claudeTarget: { runtime: 'host', wslDistro: null },
  codexTarget: { runtime: 'host', wslDistro: null },
  inactiveClaudeAccounts: [],
  inactiveCodexAccounts: []
}

// Shape-sensitive host calls that must not resolve to undefined. All values are
// empty, FIXTURE_ONLY host state; no method contacts a runtime or filesystem.
export function createBaseFixtures(): Partial<PreloadApi> {
  return {
    skills: {
      ...createSkillsApi(),
      freshnessInventory: () => Promise.resolve(freshnessInventory),
      discover: (): Promise<SkillDiscoveryResult> =>
        Promise.resolve({ skills: [], sources: [], scannedAt: FIXTURE_SCANNED_AT })
    } as unknown as PreloadApi['skills'],
    runtime: {
      getClientHostedBrowserRows: () => Promise.resolve([]),
      getTerminalFitOverrides: () => Promise.resolve([]),
      getTerminalDrivers: () => Promise.resolve([])
    } as unknown as PreloadApi['runtime'],
    rateLimits: {
      get: () => Promise.resolve(rateLimits),
      onUpdate: () => () => {}
    } as unknown as PreloadApi['rateLimits'],
    runtimeEnvironments: {
      list: () => Promise.resolve([]),
      getStatusSnapshots: () => Promise.resolve([]),
      onStatusChanged: () => () => {}
    } as unknown as PreloadApi['runtimeEnvironments']
  }
}
