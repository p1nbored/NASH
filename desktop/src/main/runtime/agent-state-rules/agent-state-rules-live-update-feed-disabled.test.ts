import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  AgentStateRulesLiveUpdater,
  agentStateRulesDownloadUrl
} from './agent-state-rules-live-update'

// D-017: with a release feed explicitly disabled the rules download must never
// reach a host, in particular not a real Orca install's `agent-state-rules-*` release.
describe('agent state rules live updates with no release feed', () => {
  it.each(['next', 'stable'] as const)('has no download address for the %s channel', (channel) => {
    expect(agentStateRulesDownloadUrl(channel)).toBeNull()
  })

  it.each(['1.4.160', '1.4.160-rc.3', '1.4.160-hourly.202607281400'])(
    'never fetches for a packaged %s build with live updates on',
    async (appVersion) => {
      const fetch = vi.fn()
      const updater = new AgentStateRulesLiveUpdater({
        userDataPath: join(tmpdir(), 'nash-feed-disabled-rules-test'),
        appVersion,
        isPackaged: true,
        fetch,
        readSettings: () => ({ agentStateRulesLiveUpdates: true }),
        onActivated: vi.fn()
      })

      await updater.start()
      await updater.refresh()
      updater.stop()

      expect(fetch).not.toHaveBeenCalled()
    }
  )
})

vi.mock('../../../shared/app-identity-constants', async (importOriginal) => {
  const actual = await importOriginal<{ APP_IDENTITY: object }>()
  return { ...actual, APP_IDENTITY: { ...actual.APP_IDENTITY, updateFeed: null } }
})
