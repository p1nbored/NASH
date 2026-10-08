// FIXTURE_ONLY: R2's pairing and refresh vectors replayed against the whole agent, which pairs,
// seals the device credential, restarts and refreshes over the real Site client and the replaying
// fake Site. Every token and credential is a synthetic vector value.
import { afterEach, describe, expect, it } from 'vitest'
import type { DotRemoteEndpointStep } from '../../../shared/dot-remote/dot-remote-vector-kit.test-fixture'
import {
  buildDotRemoteConformanceVectors,
  type DotRemoteVector
} from '../../../shared/dot-remote/dot-remote-vectors.test-fixture'

import { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { createDotRemoteAgent, type DotRemoteAgentDeps } from './dot-remote-agent'
import { failureAction } from './dot-remote-failure'
import { ensureDotRemoteSchema } from './dot-remote-schema'
import { createVectorReplay, isPairingVector } from './dot-remote-vector-replay.test-fixture'
import {
  FIXTURE_ORIGIN,
  FIXTURE_SERVICE_VALUE,
  fakeLocalEndpoint,
  memoryCredentials
} from './dot-remote.test-fixture'

// Why the only skip: NASH presents the credential it sealed last; a superseded one is a clone's.
const NASH_SIDE_SKIPS = new Set(['presents_superseded_credential'])
const NO_TIMERS = { schedule: () => ({ cancel: () => undefined }) }

const VECTORS: [string, DotRemoteVector][] = buildDotRemoteConformanceVectors()
  .vectors.filter(isPairingVector)
  .map((vector) => [vector.id, vector])

const owners: OrchestrationDb[] = []
afterEach(() => owners.splice(0).forEach((owner) => owner.close()))

function presentedBy(step: DotRemoteEndpointStep): string | null {
  return 'deviceCredential' in step.caller ? step.caller.deviceCredential : null
}

function grantOf(step: DotRemoteEndpointStep): string | null {
  const result = 'result' in step.expect ? step.expect.result : null
  const grant =
    typeof result === 'object' && result !== null ? Reflect.get(result, 'deviceCredential') : null
  const credential =
    typeof grant === 'object' && grant !== null ? Reflect.get(grant, 'credential') : null
  return typeof credential === 'string' ? credential : null
}

async function replayAgainstAgent(vector: DotRemoteVector) {
  const owner = new OrchestrationDb(':memory:')
  owners.push(owner)
  ensureDotRemoteSchema(owner.db)
  const replay = createVectorReplay(vector, { settle: false })
  const credentials = memoryCredentials()
  let ids = 0
  const deps: DotRemoteAgentDeps = {
    owner,
    credentials,
    fetch: replay.fetch,
    endpoint: fakeLocalEndpoint({}).endpoint,
    source: { snapshot: () => null },
    listWorkspaces: () => [],
    appVersion: '1.4.0',
    now: replay.now,
    timers: NO_TIMERS,
    newId: () => `60000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`,
    log: () => undefined
  }
  let agent = createDotRemoteAgent(deps)
  for (let step = replay.next(); step !== null; step = replay.next()) {
    const before = replay.position()
    if (step.endpoint === 'pairing.challenge.create') {
      agent.enable()
      agent.setConnection({ origin: FIXTURE_ORIGIN, serviceToken: FIXTURE_SERVICE_VALUE })
      await agent.startPairing()
    } else if (step.endpoint === 'pairing.session.issue') {
      await agent.tick()
    } else if (step.endpoint === 'pairing.session.refresh') {
      if (credentials.deviceValue() !== presentedBy(step)) {
        replay.skip('presents_superseded_credential')
        continue
      }
      // Why a restart: the session lives in memory only, so the next start must refresh.
      await agent.stop()
      agent = createDotRemoteAgent(deps)
      agent.start()
      await agent.tick()
    }
    if (replay.position() === before) {
      replay.skip('not_reached')
    }
  }
  return { replay, agent, credentials }
}

describe("R2's pairing and refresh vectors, NASH side", () => {
  it.each(VECTORS)('%s: NASH sends every scripted call exactly', async (_id, vector) => {
    const { replay } = await replayAgainstAgent(vector)
    expect(replay.skipped.filter((skip) => !NASH_SIDE_SKIPS.has(skip.reason))).toEqual([])
    for (const match of replay.matched) {
      expect({ endpoint: match.step.endpoint, body: match.sent }).toEqual({
        endpoint: match.step.endpoint,
        body: match.step.body
      })
      expect(match.headers).toEqual({
        service: true,
        session: false,
        device: presentedBy(match.step)
      })
    }
  })

  it.each(VECTORS)('%s: NASH keeps the newest credential, or pairs again', async (_id, vector) => {
    const { replay, agent, credentials } = await replayAgainstAgent(vector)
    const last = replay.matched.at(-1)?.step
    expect(last?.endpoint).toBe('pairing.session.refresh')
    if (last && 'error' in last.expect) {
      const action = failureAction({ kind: 'site_error', code: last.expect.error.code as never })
      expect(action.action).toBe('pair_again')
      expect(agent.status()).toMatchObject({
        state: 'pair_again',
        reconnectReason: action.action === 'pair_again' ? action.reason : null,
        pairing: null
      })
      expect(credentials.deviceValue()).toBeNull()
      return
    }
    expect(credentials.deviceValue()).toBe(last ? grantOf(last) : null)
    expect(agent.status().state).not.toBe('pair_again')
  })

  it('replays all five vectors and skips only the clone presenting a replaced credential', async () => {
    const skipped: string[] = []
    let matched = 0
    for (const [id, vector] of VECTORS) {
      const { replay } = await replayAgainstAgent(vector)
      matched += replay.matched.length
      skipped.push(...replay.skipped.map((skip) => `${id} ${skip.step.endpoint} ${skip.reason}`))
    }
    expect(VECTORS.map(([id]) => id)).toEqual([
      'pairing.refresh_ok',
      'pairing.refresh_rotation',
      'pairing.refresh_reuse_detected',
      'pairing.refresh_lifetime_expired',
      'pairing.refresh_revoked_generation'
    ])
    expect(skipped).toEqual([
      'pairing.refresh_reuse_detected pairing.session.refresh presents_superseded_credential'
    ])
    // Why 23: the five vectors hold 24 NASH steps; one is the clone above.
    expect(matched).toBe(23)
  })
})
