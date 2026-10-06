import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setClefCallCircuit } from '../clef/clef-call-circuit-owner'
import { CLEF_SCHEMA_PINS } from '../clef/clef-schema-pins'
import { createClefSpendLedger } from '../clef/clef-spend-ledger'
import { CLEF_VERIFIED_PROFILE_FILE_NAME } from '../clef/clef-verified-profile'
import { OrchestrationDb } from '../runtime/orchestration/db/orchestration-db'
import { getWorkbenchRequestStore } from '../runtime/orchestration/db/workbench-request-store'
import {
  getWorkbenchRouteStore,
  WorkbenchRouteStore
} from '../runtime/orchestration/db/workbench-route-store'
import {
  routeFixturePrincipal,
  routeFixtureWorkspace
} from '../runtime/orchestration/db/workbench-route-test-fixture'
import { submitWorkbenchRequest } from '../runtime/workbench-intake-submit'
import {
  getWorkbenchRoutingRuntime,
  setWorkbenchRoutingRuntime,
  type WorkbenchRoutingRuntime
} from '../runtime/workbench-routing/workbench-routing-runtime'
import {
  transportHangingUntilAborted,
  transportResponding
} from '../runtime/workbench-routing/workbench-runtime.test-fixture'
import { fixtureCredentialPort } from '../runtime/workbench-routing/workbench-routing.test-fixture'
import {
  installClefAdministration,
  type ClefAdministrationInput
} from './workbench-routing-clef-administration'

const NOW = Date.parse('2026-10-04T12:00:00.000Z')
const dirs: string[] = []
const owners: OrchestrationDb[] = []

afterEach(() => {
  setWorkbenchRoutingRuntime(null)
  setClefCallCircuit(null)
  for (const owner of owners.splice(0)) {
    owner.close()
  }
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function setup(
  transport: ClefAdministrationInput['transport'] = transportResponding(),
  overrides: Partial<ClefAdministrationInput> = {}
) {
  const owner = new OrchestrationDb(':memory:')
  owners.push(owner)
  const userDataPath = mkdtempSync(join(tmpdir(), 'orca-workbench-install-'))
  dirs.push(userDataPath)
  const logged: unknown[][] = []
  const sink = vi.fn(transport ?? transportResponding())
  const credentials = fixtureCredentialPort()
  const installed = installClefAdministration({
    owner,
    userDataPath,
    credentials,
    transport: sink,
    now: () => NOW,
    logFailure: (...args) => logged.push(args),
    ...overrides
  })
  return {
    owner,
    userDataPath,
    logged,
    transport: sink,
    credentials,
    installed,
    runtime: installed.runtime
  }
}

async function pin(runtime: WorkbenchRoutingRuntime): Promise<void> {
  const verified = await runtime.verifyClef()
  if (verified.outcome !== 'reported') {
    throw new Error('the fixture verification must produce a report')
  }
  runtime.pinClefProfile(verified.reportSha256)
}

describe('installClefAdministration: startup order', () => {
  it('runs startup recovery before the runtime is installed and leaves received requests as they were', () => {
    const owner = new OrchestrationDb(':memory:')
    owners.push(owner)
    const received = getWorkbenchRequestStore(owner).submit(
      routeFixturePrincipal,
      {
        workspaceId: routeFixtureWorkspace.workspaceId,
        objective: 'Plan the retry button for the Workbench queue.',
        idempotencyKey: randomUUID()
      },
      routeFixtureWorkspace
    ).request
    expect(getWorkbenchRoutingRuntime()).toBeNull()
    const recover = WorkbenchRouteStore.prototype.recoverInterruptedRouting
    const runtimeAtRecovery: unknown[] = []
    const spy = vi
      .spyOn(WorkbenchRouteStore.prototype, 'recoverInterruptedRouting')
      .mockImplementation(function (this: WorkbenchRouteStore) {
        runtimeAtRecovery.push(getWorkbenchRoutingRuntime())
        return recover.call(this)
      })
    const userDataPath = mkdtempSync(join(tmpdir(), 'orca-workbench-install-'))
    dirs.push(userDataPath)
    try {
      installClefAdministration({
        owner,
        userDataPath,
        credentials: fixtureCredentialPort(),
        transport: transportResponding(),
        now: () => NOW
      })
    } finally {
      spy.mockRestore()
    }

    expect(runtimeAtRecovery).toEqual([null])
    expect(getWorkbenchRoutingRuntime()).not.toBeNull()
    expect(
      getWorkbenchRequestStore(owner).get(
        routeFixturePrincipal,
        { workspaceId: routeFixtureWorkspace.workspaceId, requestId: received.requestId },
        routeFixtureWorkspace
      )
    ).toEqual(received)
  })

  it('releases a verification reservation a crashed call left open and keeps it counted as spent', () => {
    const owner = new OrchestrationDb(':memory:')
    owners.push(owner)
    const routes = getWorkbenchRouteStore(owner)
    const ledger = createClefSpendLedger({ store: routes.spend, now: () => NOW })
    const reserved = routes.spend.atomically(() =>
      ledger.reserve({ requestId: null, purpose: 'verification', estimatedInputTokens: 800 })
    )
    expect(reserved.ok).toBe(true)
    const userDataPath = mkdtempSync(join(tmpdir(), 'orca-workbench-install-'))
    dirs.push(userDataPath)

    const { runtime } = installClefAdministration({
      owner,
      userDataPath,
      credentials: fixtureCredentialPort(),
      transport: transportResponding(),
      now: () => NOW
    })

    const rows = owner.db
      .prepare('SELECT purpose, state, spent_micro_usd FROM workbench_clef_spend')
      .all()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ purpose: 'verification', state: 'released' })
    expect(Number(rows[0]?.spent_micro_usd)).toBeGreaterThan(0)
    expect(runtime.routingStatusView().status).toBe('contract_unverified')
  })

  it('installs the runtime the RPC layer reads', () => {
    const { runtime } = setup()
    expect(getWorkbenchRoutingRuntime()).toBe(runtime)
  })

  it('hands the classifier the same credentials and transport, without reading either', () => {
    const { installed, credentials, transport } = setup()
    expect(installed.classifier.credentials).toBe(credentials)
    expect(installed.classifier.transport).toBe(transport)
    expect(transport).not.toHaveBeenCalled()
  })

  it('hands the classifier a spend ledger over the same database spend table', () => {
    const { installed, owner } = setup()
    const reserved = getWorkbenchRouteStore(owner).spend.atomically(() =>
      installed.classifier.ledger.reserve({
        requestId: null,
        purpose: 'verification',
        estimatedInputTokens: 800
      })
    )
    expect(reserved.ok).toBe(true)
    const purposes = owner.db.prepare('SELECT purpose FROM workbench_clef_spend').all()
    expect(purposes.map((row) => row.purpose)).toEqual(['verification'])
  })

  it('needs no eligibility, settings or rate-limit port, because nothing routes at intake', () => {
    const { runtime } = setup()
    expect(Object.keys(runtime).sort()).toEqual([
      'abortAllRouting',
      'pinClefProfile',
      'reportFailure',
      'routingStatusView',
      'verifyClef'
    ])
  })
})

describe('installClefAdministration: configuration', () => {
  it('needs no spend cap (D-022), so only the missing profile reads as unverified', () => {
    const { runtime, installed, owner } = setup()
    expect(runtime.routingStatusView().status).toBe('contract_unverified')
    expect(Object.keys(runtime.routingStatusView())).not.toContain('caps')
    // Why: verification spend far past the old US$5 cap is still recorded, never refused.
    for (let call = 0; call < 20; call += 1) {
      const reserved = getWorkbenchRouteStore(owner).spend.atomically(() =>
        installed.classifier.ledger.reserve({
          requestId: null,
          purpose: 'verification',
          estimatedInputTokens: 1_000_000
        })
      )
      expect(reserved.ok).toBe(true)
    }
  })

  it('keeps the verified profile in a file under the user data directory and nowhere else', async () => {
    const { runtime, userDataPath } = setup()
    const file = join(userDataPath, CLEF_VERIFIED_PROFILE_FILE_NAME)
    expect(existsSync(file)).toBe(false)
    await pin(runtime)
    expect(existsSync(file)).toBe(true)
    const stored: unknown = JSON.parse(readFileSync(file, 'utf8'))
    expect(stored).toMatchObject({ profileVersion: 2, schemaPins: CLEF_SCHEMA_PINS })
    expect(stored).not.toHaveProperty('scoreKeyForm')
    expect(runtime.routingStatusView().status).toBe('ready')
  })

  it('keeps status working when the profile file cannot be read', () => {
    const { runtime, userDataPath, logged } = setup()
    // Why a directory: reading it fails with a system error, as a locked or damaged file would.
    mkdirSync(join(userDataPath, CLEF_VERIFIED_PROFILE_FILE_NAME))
    expect(runtime.routingStatusView().status).toBe('contract_unverified')
    // Why once: status reads the profile on every call, so a repeating failure must not flood the log.
    expect(logged).toHaveLength(1)
  })

  it('treats a profile pinned against other schema pins as unverified', async () => {
    const { runtime, userDataPath } = setup()
    await pin(runtime)
    const file = join(userDataPath, CLEF_VERIFIED_PROFILE_FILE_NAME)
    const stored: { schemaPins: Record<string, string> } = JSON.parse(readFileSync(file, 'utf8'))
    writeFileSync(
      file,
      JSON.stringify({
        ...stored,
        schemaPins: { ...stored.schemaPins, docsRevision: 'an-older-docs-revision' }
      })
    )
    expect(runtime.routingStatusView().status).toBe('contract_unverified')
  })

  it('reads a profile file pinned by version 1, the score-form build, as absent', async () => {
    const { runtime, userDataPath } = setup()
    await pin(runtime)
    const file = join(userDataPath, CLEF_VERIFIED_PROFILE_FILE_NAME)
    const stored: Record<string, unknown> = JSON.parse(readFileSync(file, 'utf8'))
    expect(runtime.routingStatusView().status).toBe('ready')
    // Why: version 1 carried the score key form; nothing live ever wrote one, so reading it as absent loses nothing.
    writeFileSync(
      file,
      JSON.stringify({ ...stored, profileVersion: 1, scoreKeyForm: 'level_index' })
    )
    expect(runtime.routingStatusView().status).toBe('contract_unverified')
    expect(runtime.routingStatusView().profile.present).toBe(false)
  })

  it('records a verification call as verification spend, never as production spend', async () => {
    const { runtime, owner } = setup()
    await pin(runtime)
    const purposes = owner.db.prepare('SELECT purpose FROM workbench_clef_spend').all()
    expect(purposes.map((row) => row.purpose)).toEqual(['verification'])
  })
})

describe('installClefAdministration: intake stays decoupled from Clef', () => {
  it('records a submit as received after Clef is verified and pinned, and spends nothing more', async () => {
    const { runtime, owner, transport } = setup()
    await pin(runtime)
    expect(runtime.routingStatusView().status).toBe('ready')
    const calls = transport.mock.calls.length
    const { request } = submitWorkbenchRequest(
      {
        owner,
        store: getWorkbenchRequestStore(owner),
        principalId: routeFixturePrincipal,
        workspace: routeFixtureWorkspace
      },
      {
        workspaceId: routeFixtureWorkspace.workspaceId,
        objective: 'Plan the retry button for the Workbench queue.',
        idempotencyKey: randomUUID()
      }
    )
    await new Promise((resolve) => setImmediate(resolve))
    // Why ROUTING: the v3 view shows a RECEIVED request, not yet launched, as ROUTING (D-016 section 1.2).
    expect(request).toMatchObject({ status: 'ROUTING', routingBlocker: null, workflowRunId: null })
    expect(transport.mock.calls).toHaveLength(calls)
    const purposes = owner.db.prepare('SELECT purpose FROM workbench_clef_spend').all()
    expect(purposes.map((row) => row.purpose)).toEqual(['verification'])
  })
})

describe('installClefAdministration: shutdown and failures', () => {
  it('uninstall aborts the in-flight verification call and unpublishes the runtime', async () => {
    let started: () => void = () => undefined
    const inFlight = new Promise<void>((resolve) => {
      started = resolve
    })
    const { runtime, installed } = setup(transportHangingUntilAborted(started))
    const verifying = runtime.verifyClef()
    await inFlight

    installed.uninstall()

    expect(getWorkbenchRoutingRuntime()).toBeNull()
    expect(await verifying).toMatchObject({
      outcome: 'call_failed',
      blocker: { detail: 'interrupted' }
    })
  })

  it('hands runtime failures to a sink that redacts them', () => {
    const { runtime, logged } = setup()
    runtime.reportFailure(
      new Error('failed for /client/v4/accounts/0123456789abcdef0123456789abcdef/ai/run')
    )
    expect(logged).toHaveLength(1)
    expect(JSON.stringify(logged[0])).not.toContain('0123456789abcdef0123456789abcdef')
  })
})
