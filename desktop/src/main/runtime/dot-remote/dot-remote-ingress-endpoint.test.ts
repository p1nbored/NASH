// FIXTURE_ONLY: the real dot listener on a temporary data folder and a memory database; the token is
// the per-start one it writes, and nothing leaves this process.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DotIngressListener } from '../dot-ingress/dot-ingress-listener'
import { FIXTURE_RUNTIME_ID } from '../dot-ingress/dot-ingress-transport.test-fixture'
import { OrchestrationDb } from '../orchestration/db'
import { createDotIngressEndpointClient } from './dot-remote-ingress-client'

describe('the remote agent reaches the real dot endpoint as the dot client does', () => {
  let userDataPath: string
  let db: OrchestrationDb
  let listener: DotIngressListener
  let enabled: boolean

  beforeEach(() => {
    userDataPath = mkdtempSync(join(tmpdir(), 'r1-dot-endpoint-'))
    db = new OrchestrationDb(':memory:')
    enabled = false
    listener = new DotIngressListener({
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the listener reads only the members this fixture provides.
      runtime: {
        getRuntimeId: () => FIXTURE_RUNTIME_ID,
        getStartedAt: () => 1_790_000_000_000,
        getOrchestrationDb: () => db
      } as never,
      userDataPath,
      pid: process.pid,
      platform: process.platform,
      readEnabled: () => enabled
    })
  })

  afterEach(async () => {
    await listener.shutdown()
    db.close()
    rmSync(userDataPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  })

  it('reads the discovery file and is answered with the ingress token', async () => {
    enabled = true
    await listener.sync()
    const client = createDotIngressEndpointClient({ userDataPath, ready: () => true })
    expect(await client.call('dotIngress.hello', { contractVersion: 1 }, 5_000)).toEqual({
      ok: true,
      result: expect.objectContaining({ contractVersion: 1 })
    })
  })

  it('passes a refusal code through and is unavailable once the interface is off', async () => {
    enabled = true
    await listener.sync()
    const client = createDotIngressEndpointClient({ userDataPath, ready: () => true })
    const refused = await client.call('dotIngress.requests.submit', { contractVersion: 2 }, 5_000)
    expect(refused).toMatchObject({ ok: false, kind: 'refused' })
    enabled = false
    await listener.sync()
    expect(await client.call('dotIngress.hello', { contractVersion: 1 }, 5_000)).toEqual({
      ok: false,
      kind: 'unavailable'
    })
  })
})
