// FIXTURE_ONLY: the real dot listener on a temporary data folder and a memory database; the token is
// the per-start one it writes, and nothing leaves this process.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { dotRemoteNashRefusal } from '../../../shared/dot-remote/dot-remote-errors'
import { DotRemoteInboxItemSchema } from '../../../shared/dot-remote/dot-remote-inbox'
import { leased, payloadOf } from '../../../shared/dot-remote/dot-remote-vector-kit.test-fixture'
import { DotIngressListener } from '../dot-ingress/dot-ingress-listener'
import {
  FIXTURE_BINDING,
  FIXTURE_OBJECTIVE,
  FIXTURE_WORKSPACE,
  fixtureUuid
} from '../dot-ingress/dot-ingress-service.test-fixture'
import { FIXTURE_RUNTIME_ID } from '../dot-ingress/dot-ingress-transport.test-fixture'
import { OrchestrationDb } from '../orchestration/db'
import { getDotIngressSettingsStore } from '../orchestration/db/dot-ingress-settings-store'
import { createDotIngressEndpointClient } from './dot-remote-ingress-client'
import { dispatchLeasedItem } from './dot-remote-item-dispatch'

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
    expect(await client.call('dotIngress.hello', { contractVersion: 3 }, 5_000)).toEqual({
      ok: true,
      result: expect.objectContaining({ contractVersion: 3 })
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
    expect(await client.call('dotIngress.hello', { contractVersion: 3 }, 5_000)).toEqual({
      ok: false,
      kind: 'unavailable'
    })
  })

  // D-034: past the remote cap, the workspace maximum is the dot endpoint's own admission
  // (admitDotIntake), exactly as for a local dot client.
  it('refuses a remote write item above the workspace maximum at the dot endpoint', async () => {
    const timestamp = '2026-10-05T12:00:00.000Z'
    const settings = getDotIngressSettingsStore(db)
    settings.setEnabled({ enabled: true, timestamp })
    const { workspaceRef } = settings.enableWorkspace({
      workspaceId: FIXTURE_WORKSPACE.workspaceId,
      workspaceBinding: FIXTURE_BINDING,
      label: 'fixture-repo',
      timestamp
    }).workspace
    expect(settings.getWorkspaceMaxAccess(workspaceRef)).toBe('read_only')
    enabled = true
    await listener.sync()
    const payload = payloadOf('submit', {
      workspaceRef,
      objective: FIXTURE_OBJECTIVE,
      idempotencyKey: fixtureUuid(1),
      requestedAccess: 'workspace_write'
    })
    const item = DotRemoteInboxItemSchema.parse(
      leased({ item: 1, kind: 'submit', payload, created: 0, leased: 1, nonce: 1 })
    )
    const endpoint = createDotIngressEndpointClient({ userDataPath, ready: () => true })
    expect(await dispatchLeasedItem(item, { endpoint, requestOfItem: () => null })).toEqual({
      kind: 'decided',
      outcome: {
        outcome: 'refused',
        dotRequestId: null,
        refusal: dotRemoteNashRefusal('dot_access_above_maximum')
      },
      messageOutcome: null
    })
    expect(db.db.prepare('SELECT count(*) AS n FROM dot_ingress_requests').get()).toEqual({ n: 0 })
  })
})
