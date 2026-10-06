import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  WorkbenchDotRemotePairingViewSchema,
  WorkbenchDotRemoteStatusViewSchema
} from '../../../shared/rpc-contract/workbench-dot-remote-params'
import { OrchestrationError } from '../orchestration/orchestration-error'
import { createAgentHarness, WORKSPACE, type AgentHarness } from './dot-remote-agent.test-fixture'
import { getDotRemoteSettingsStore } from './dot-remote-settings-store'
import { FIXTURE_DEVICE, FIXTURE_ORIGIN, FIXTURE_SERVICE_VALUE } from './dot-remote.test-fixture'

async function codeOf(run: () => unknown): Promise<string | null> {
  try {
    await run()
    return null
  } catch (error) {
    return error instanceof OrchestrationError ? error.code : 'not_an_orchestration_error'
  }
}

describe('dot remote agent: switch, connection and pairing', () => {
  let h: AgentHarness
  beforeEach(() => {
    h = createAgentHarness()
  })
  afterEach(() => h.close())

  it('is off by default and makes no request when started', async () => {
    h.agent.start()
    await h.timers.advance(120_000)
    expect(h.fetch).not.toHaveBeenCalled()
    expect(WorkbenchDotRemoteStatusViewSchema.parse(h.agent.status())).toEqual({
      state: 'off',
      enabled: false,
      origin: null,
      serviceToken: 'absent',
      reconnectReason: null,
      pairing: null,
      localEndpoint: 'ready',
      lastSyncAt: null,
      pendingEvents: 0,
      syncFailure: null
    })
  })

  it('is unpaired once enabled, still without any request', async () => {
    h.agent.enable()
    await h.timers.advance(120_000)
    expect(h.agent.status().state).toBe('unpaired')
    expect(h.fetch).not.toHaveBeenCalled()
  })

  it('accepts only an https origin and a well-formed token, by code and without echo', async () => {
    const http = await codeOf(() =>
      h.agent.setConnection({
        origin: 'http://fixture.example.test',
        serviceToken: FIXTURE_SERVICE_VALUE
      })
    )
    expect(http).toBe('dot_remote_origin_invalid')
    const short = await codeOf(() =>
      h.agent.setConnection({ origin: FIXTURE_ORIGIN, serviceToken: 'short' })
    )
    expect(short).toBe('dot_remote_token_invalid')
    expect(h.agent.status().origin).toBeNull()
    expect(h.credentials.status().present).toBe(false)
  })

  it('seals the token, stores the origin only, and never returns the token', async () => {
    const view = h.agent.setConnection({
      origin: `${FIXTURE_ORIGIN}/`,
      serviceToken: `Bearer ${FIXTURE_SERVICE_VALUE}`
    })
    expect(view).toMatchObject({ origin: FIXTURE_ORIGIN, serviceToken: 'sealed' })
    expect(JSON.stringify(view)).not.toContain(FIXTURE_SERVICE_VALUE)
    expect(h.credentials.read()?.authorizationHeader()).toBe(`Bearer ${FIXTURE_SERVICE_VALUE}`)
    const rows = h.owner.db.prepare('SELECT * FROM dot_remote_settings').all()
    expect(JSON.stringify(rows)).not.toContain(FIXTURE_SERVICE_VALUE)
  })

  it('refuses to store the token when sealing is unavailable, with no plaintext fallback', async () => {
    const plain = createAgentHarness({ sealing: false })
    try {
      const code = await codeOf(() =>
        plain.agent.setConnection({ origin: FIXTURE_ORIGIN, serviceToken: FIXTURE_SERVICE_VALUE })
      )
      expect(code).toBe('dot_remote_sealing_unavailable')
      expect(plain.credentials.read()).toBeNull()
    } finally {
      plain.close()
    }
  })

  it('refuses to pair while off or not configured', async () => {
    expect(await codeOf(() => h.agent.startPairing())).toBe('dot_remote_disabled')
    h.agent.enable()
    expect(await codeOf(() => h.agent.startPairing())).toBe('dot_remote_not_configured')
    expect(h.fetch).not.toHaveBeenCalled()
  })

  it('pairs through an owner-approved user code and connects', async () => {
    await h.configure()
    const started = await h.agent.startPairing()
    expect(WorkbenchDotRemotePairingViewSchema.parse(started.pairing)).toMatchObject({
      state: 'waiting_for_approval',
      userCode: 'BCDF-GHJK'
    })
    expect(started.status.state).toBe('pairing')
    await h.timers.advance(5_000)
    expect(h.agent.pairingStatus().state).toBe('waiting_for_approval')
    h.site.approve()
    await h.timers.advance(5_000)
    expect(h.agent.pairingStatus()).toEqual({ state: 'paired', userCode: null, expiresAt: null })
    expect(h.agent.status()).toMatchObject({
      state: 'connected',
      pairing: { deviceId: FIXTURE_DEVICE, generation: 1 }
    })
    expect(h.site.heartbeats).toEqual([
      expect.objectContaining({ generation: 1, appVersion: '1.4.0', contractVersion: 3 })
    ])
    expect(h.site.workspaceLists).toEqual([
      expect.objectContaining({ generation: 1, workspaces: [WORKSPACE] })
    ])
    expect(h.agent.status().lastSyncAt).not.toBeNull()
  })

  it('reports a denied pairing and stays unpaired', async () => {
    await h.configure()
    await h.agent.startPairing()
    h.site.approve(false)
    await h.timers.advance(5_000)
    expect(h.agent.pairingStatus().state).toBe('denied')
    expect(h.agent.status().state).toBe('unpaired')
  })

  it('expires a pairing nobody approved', async () => {
    await h.configure()
    await h.agent.startPairing()
    await h.timers.advance(11 * 60_000)
    expect(h.agent.pairingStatus().state).toBe('expired')
  })

  it('needs a reconnect when the Site refuses the service token, and falls back to nothing', async () => {
    await h.configure()
    h.site.rejectServiceToken()
    expect(await codeOf(() => h.agent.startPairing())).toBe('dot_remote_reconnect_needed')
    expect(h.agent.status()).toMatchObject({
      state: 'reconnect_needed',
      reconnectReason: 'service_token_rejected'
    })
    const calls = h.fetch.mock.calls.length
    await h.timers.advance(120_000)
    expect(h.fetch.mock.calls.length).toBe(calls)
  })

  it('reports a Site it cannot reach while pairing', async () => {
    await h.configure()
    h.site.failNext('POST /nash/v1/pairing/challenges', new Response('down', { status: 503 }))
    expect(await codeOf(() => h.agent.startPairing())).toBe('dot_remote_site_unreachable')
  })

  it('resumes the pairing after a restart without asking the owner again', async () => {
    await h.pair()
    await h.agent.stop()
    const restarted = h.restart()
    restarted.start()
    expect(restarted.status()).toMatchObject({
      state: 'offline',
      pairing: { deviceId: FIXTURE_DEVICE, generation: 1 }
    })
    await h.timers.advance(1_000)
    expect(h.site.calls).toContain('POST /nash/v1/session/refresh')
    expect(restarted.status()).toMatchObject({
      state: 'connected',
      pairing: { deviceId: FIXTURE_DEVICE, generation: 1 }
    })
  })

  it('drops the pairing of an old origin when the origin changes', async () => {
    await h.pair()
    h.agent.setConnection({
      origin: 'https://other-fixture.example.test',
      serviceToken: FIXTURE_SERVICE_VALUE
    })
    expect(h.agent.status()).toMatchObject({ state: 'unpaired', pairing: null })
    expect(getDotRemoteSettingsStore(h.owner).getPairing()?.revokedAt).not.toBeNull()
  })
})
