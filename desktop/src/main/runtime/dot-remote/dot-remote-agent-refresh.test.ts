// FIXTURE_ONLY: the agent against the fake Site's device credentials; every value is synthetic.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WorkbenchDotRemoteStatusViewSchema } from '../../../shared/rpc-contract/workbench-dot-remote-params'
import type { DotRemoteAgent } from './dot-remote-agent'
import { createAgentHarness, type AgentHarness } from './dot-remote-agent.test-fixture'
import { FIXTURE_DEVICE } from './dot-remote.test-fixture'

const SECRET_MARK = 'FIXTUREdeviceCredentialSecret'
const REFRESH = 'POST /nash/v1/session/refresh'
const DAY_MS = 86_400_000

describe('dot remote agent: device credential and refresh', () => {
  let h: AgentHarness
  let agent: DotRemoteAgent
  beforeEach(async () => {
    h = createAgentHarness()
    await h.pair()
    agent = h.agent
  })
  afterEach(() => h.close())

  const refreshes = () => h.site.calls.filter((call) => call === REFRESH).length
  const leases = () => h.site.calls.filter((call) => call === 'POST /nash/v1/inbox/lease').length

  async function restart(): Promise<DotRemoteAgent> {
    await agent.stop()
    agent = h.restart()
    agent.start()
    return agent
  }

  async function expectStopped(reason: string): Promise<void> {
    expect(agent.status()).toMatchObject({
      state: 'pair_again',
      reconnectReason: reason,
      pairing: null
    })
    expect(h.credentials.deviceValue()).toBeNull()
    const calls = h.site.calls.length
    await h.timers.advance(10 * 60_000)
    expect(h.site.calls.length).toBe(calls)
  }

  it('seals the device credential the Site issues and shows only how long the pairing lasts', () => {
    expect(h.credentials.deviceValue()).toBe(h.site.devices.current())
    const status = WorkbenchDotRemoteStatusViewSchema.parse(agent.status())
    expect(status.pairing).toMatchObject({
      deviceId: FIXTURE_DEVICE,
      pairedUntil: h.site.devices.expiresAt()
    })
    expect(JSON.stringify(status)).not.toContain(SECRET_MARK)
  })

  it('resumes after a restart through a refresh, rotates the credential and polls again', async () => {
    const issued = h.credentials.deviceValue()
    await restart()
    expect(agent.status().state).toBe('offline')
    await h.timers.advance(1_000)
    expect(refreshes()).toBe(1)
    expect(h.site.devices.presented).toEqual([issued])
    expect(h.credentials.deviceValue()).toBe(h.site.devices.current())
    expect(h.credentials.deviceValue()).not.toBe(issued)
    expect(agent.status().state).toBe('connected')
    const before = leases()
    await h.timers.advance(60_000)
    expect(leases() - before).toBe(2)
  })

  it('refreshes once the session ended while the Site was unreachable', async () => {
    h.site.failNext('POST /nash/v1/heartbeat', new Response('down', { status: 503 }))
    for (let attempt = 0; attempt < 40; attempt += 1) {
      h.site.failNext('POST /nash/v1/session/renew', new Response('down', { status: 503 }))
    }
    await h.timers.advance(20 * 60_000)
    expect(refreshes()).toBeGreaterThan(0)
    expect(agent.status().state).toBe('connected')
  })

  it('stores the rotated credential before it uses the new session', async () => {
    const seen: { key: string; stored: string | null }[] = []
    h.fetch.mockImplementation(async (url, init) => {
      const response = await h.site.fetch(url, init)
      seen.push({
        key: `${init.method} ${new URL(url).pathname}`,
        stored: h.credentials.deviceValue()
      })
      return response
    })
    await restart()
    await h.timers.advance(1_000)
    const afterRefresh = seen.slice(seen.findIndex((entry) => entry.key === REFRESH) + 1)
    expect(afterRefresh.length).toBeGreaterThan(0)
    for (const entry of afterRefresh) {
      expect(entry.stored).toBe(h.site.devices.current())
    }
  })

  it('stops and asks to pair again when the rotated credential cannot be stored', async () => {
    h.credentials.failDeviceWrites(true)
    await restart()
    await h.timers.advance(1_000)
    expect(h.site.calls.at(-1)).toBe(REFRESH)
    await expectStopped('device_credential_unsaved')
  })

  it('keeps the credential and backs off while the Site cannot be reached', async () => {
    const issued = h.credentials.deviceValue()
    for (let attempt = 0; attempt < 4; attempt += 1) {
      h.site.failNext(REFRESH, new Response('down', { status: 503 }))
    }
    await restart()
    await h.timers.advance(1_000)
    expect(refreshes()).toBe(1)
    expect(agent.status().state).toBe('offline')
    expect(h.credentials.deviceValue()).toBe(issued)
    await h.timers.advance(5_000)
    expect(refreshes()).toBe(2)
    await h.timers.advance(5_000)
    expect(refreshes()).toBe(2)
    await h.timers.advance(5_000)
    expect(refreshes()).toBe(3)
    await h.timers.advance(5 * 60_000)
    expect(agent.status().state).toBe('connected')
    expect(h.credentials.deviceValue()).toBe(h.site.devices.current())
  })

  it('asks to pair again when the Site reports the credential as reused', async () => {
    h.site.devices.rotateBehindNash()
    await restart()
    await h.timers.advance(1_000)
    await expectStopped('device_credential_reused')
  })

  it('asks to pair again when the pairing reached its lifetime', async () => {
    await restart()
    h.clock.advance(31 * DAY_MS)
    await h.timers.advance(1_000)
    await expectStopped('pairing_expired')
  })

  it('asks to pair again when the pairing lifetime ends while the app runs', async () => {
    h.clock.advance(30 * DAY_MS - 60_000)
    await h.timers.advance(10 * 60_000)
    await expectStopped('pairing_expired')
  })

  it('asks to pair again when the Site does not know the credential', async () => {
    h.site.devices.forget()
    await restart()
    await h.timers.advance(1_000)
    await expectStopped('device_credential_invalid')
  })

  it('asks to pair again when the pairing was revoked while the app was closed', async () => {
    h.site.revokeOnSite()
    await restart()
    await h.timers.advance(1_000)
    await expectStopped('pairing_revoked')
  })

  it('asks to pair again after a restart when no credential is stored, without calling the Site', async () => {
    h.credentials.clearDevice()
    const calls = h.site.calls.length
    await restart()
    await h.timers.advance(1_000)
    expect(h.site.calls.length).toBe(calls)
    await expectStopped('session_ended')
  })

  it('lets a refresh in flight finish on quit and seals the rotated credential', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    h.fetch.mockImplementation(async (url, init) => {
      if (new URL(url).pathname === '/nash/v1/session/refresh') {
        await gate
      }
      return h.site.fetch(url, init)
    })
    await restart()
    const ticking = h.timers.advance(1_000)
    await new Promise((resolve) => setImmediate(resolve))
    const quitting = agent.stop()
    release()
    await Promise.all([ticking, quitting])
    expect(refreshes()).toBe(1)
    expect(h.credentials.deviceValue()).toBe(h.site.devices.current())
  })

  it('deletes the stored credential when the pairing is revoked from the app', async () => {
    const result = await agent.revoke()
    expect(result.status).toMatchObject({ state: 'unpaired', pairing: null })
    expect(h.credentials.deviceValue()).toBeNull()
  })

  it('never puts the device credential into a log line or an RPC result', async () => {
    const results: unknown[] = [agent.status(), agent.pairingStatus()]
    await restart()
    await h.timers.advance(1_000)
    results.push(agent.status())
    h.site.devices.rotateBehindNash()
    await restart()
    await h.timers.advance(1_000)
    results.push(agent.status(), await agent.revoke())
    const text = JSON.stringify([results, h.log.mock.calls])
    expect(text).not.toContain(SECRET_MARK)
    expect(text).not.toContain('ndc_')
  })
})

describe('dot remote agent: a pairing whose credential cannot be sealed', () => {
  it('never uses the issued session and asks to pair again', async () => {
    const h = createAgentHarness()
    await h.configure()
    await h.agent.startPairing()
    h.credentials.failDeviceWrites(true)
    h.site.approve()
    await h.timers.advance(5_000)
    expect(h.site.calls.at(-1)).toBe('POST /nash/v1/pairing/session')
    expect(h.agent.status()).toMatchObject({
      state: 'pair_again',
      reconnectReason: 'device_credential_unsaved',
      pairing: null
    })
    expect(h.credentials.deviceValue()).toBeNull()
    h.close()
  })
})
