import { readdirSync, readFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RpcDispatcher } from './dispatcher'
import type { RpcRequest } from './core'
import { ALL_RPC_METHODS } from './methods'
import { WORKBENCH_METHODS } from './methods/workbench'
import { registerValidationBacklogPort } from '../task-validation/validation-backlog-port'
import { issueWorkbenchDesktopCaller } from '../workbench-caller'
import {
  createWorkbenchRoutingRuntime,
  setWorkbenchRoutingRuntime,
  type WorkbenchRoutingRuntime
} from '../workbench-routing/workbench-routing-runtime'
import {
  FIXTURE_ONLY_WORKSPACE,
  createRuntimeHarness,
  type RuntimeHarness
} from '../workbench-routing/workbench-runtime.test-fixture'

// The Orca CLI, agents and paired devices reach the dispatcher without a trusted desktop caller, so
// none of them may reach a paid call. Every `workbench.*` method is checked, whatever its cost.
const workspaceId = FIXTURE_ONLY_WORKSPACE.workspaceId
const runId = 'run_0123456789ab'
const tableBase = { table_version: 1, sha256: 'ab'.repeat(32) }
// Valid params for each D-016 method, so a refusal comes from the caller check and not from parsing.
const D016_METHOD_PARAMS: Readonly<Record<string, unknown>> = {
  'workbench.runs.list': {},
  'workbench.runs.show': { runId },
  'workbench.runs.stop': { runId },
  'workbench.runs.message': {
    runId,
    idempotencyKey: '5d0f3c5e-0a51-4a8f-9c43-3d41f2d0b6a1',
    text: 'Please also check the tests.'
  },
  'workbench.runs.tasks': { runId },
  'workbench.routingTable.list': {},
  'workbench.routingTable.save': {
    base: tableBase,
    changes: [
      {
        task_type: 'software_engineering',
        execution_target: 'codex_cli',
        model: 'gpt-6-astra',
        reasoning_level: 'max'
      }
    ]
  },
  'workbench.routingTable.checkRoutes': {},
  'workbench.permission.list': { runId, limit: 10 },
  'workbench.permission.answer': { decisionId: 'pd_0123456789ab', decision: 'allow' },
  'workbench.dotIngress.settings.get': undefined,
  'workbench.dotIngress.settings.setEnabled': { enabled: true },
  'workbench.dotIngress.settings.setRateLimits': { ratePerMinute: 6, ratePerUtcDay: 100 },
  'workbench.dotIngress.workspaces.enable': { workspaceId, label: 'Fixture workspace' },
  'workbench.dotIngress.workspaces.disable': { workspaceRef: `dws_${'0'.repeat(24)}` },
  'workbench.dotIngress.requests.list': { limit: 10 },
  'workbench.dotRemote.status': undefined,
  'workbench.dotRemote.enable': undefined,
  'workbench.dotRemote.disable': undefined,
  'workbench.dotRemote.setConnection': {
    origin: 'https://fixture-nash.example.test',
    serviceToken: 'FIXTURE_ONLY_sites_service_token_0000000000'
  },
  'workbench.dotRemote.pairing.start': undefined,
  'workbench.dotRemote.pairing.status': undefined,
  'workbench.dotRemote.revoke': undefined,
  'workbench.validation.checkPending': {},
  'workbench.validation.listDecisions': {},
  'workbench.validation.decide': { validationId: 'validation_0123456789ab', decision: 'waive' }
}
const METHOD_PARAMS: Readonly<Record<string, unknown>> = {
  ...D016_METHOD_PARAMS,
  'workbench.requests.submit': {
    workspaceId,
    objective: 'Inspect this change.',
    idempotencyKey: '8f18f989-8a86-423e-8e45-3416e01a14d2'
  },
  'workbench.requests.list': { workspaceId, limit: 10 },
  'workbench.requests.cancel': { workspaceId, requestId: 'request-one', expectedRevision: 1 },
  'workbench.routing.status': {},
  'workbench.clef.verify': {},
  'workbench.clef.profile.pin': { reportSha256: 'ab'.repeat(32) }
}
const ADMINISTRATION_METHODS = [
  'workbench.routing.status',
  'workbench.clef.verify',
  'workbench.clef.profile.pin'
] as const
const RETIRED_METHODS = ['workbench.route.retry', 'workbench.route.decision.get'] as const

const FORGED_FIELDS = { principalId: 'local-desktop-ui', source: 'desktop_ui' } as const
const issued = issueWorkbenchDesktopCaller()
const CALLERS: readonly (readonly [string, Record<string, unknown>])[] = [
  ['no caller at all', {}],
  [
    'the Orca CLI with its local token',
    { clientId: 'orca-cli', clientKind: 'runtime', authenticatedCallerFingerprint: 'claimed-human' }
  ],
  [
    'a paired mobile device',
    { clientId: 'mobile-device', clientKind: 'mobile', pairedDeviceId: 'phone-1' }
  ],
  [
    'a desktop renderer id without an issued caller',
    { clientId: 'desktop-renderer', clientKind: 'runtime' }
  ],
  ['a copied caller object', { workbenchCaller: { ...issued } }],
  ['a frozen copy of the caller', { workbenchCaller: Object.freeze({ ...issued }) }],
  ['a cloned caller', { workbenchCaller: JSON.parse(JSON.stringify(issued)) }],
  ['a hand-built caller', { workbenchCaller: FORGED_FIELDS }]
]

let harness: RuntimeHarness | null = null
let installed: WorkbenchRoutingRuntime
let spies: ReturnType<typeof vi.fn>[]

beforeEach(() => {
  harness = createRuntimeHarness()
  const real = createWorkbenchRoutingRuntime({ ...harness.deps, admin: harness.admin })
  const verifyClef = vi.fn(real.verifyClef)
  const pinClefProfile = vi.fn(real.pinClefProfile)
  const routingStatusView = vi.fn(real.routingStatusView)
  spies = [verifyClef, pinClefProfile, routingStatusView]
  installed = { ...real, verifyClef, pinClefProfile, routingStatusView }
  setWorkbenchRoutingRuntime(installed)
})

afterEach(() => {
  setWorkbenchRoutingRuntime(null)
  harness?.close()
  harness = null
})

function fixtureRuntime(h: RuntimeHarness) {
  return {
    getRuntimeId: vi.fn(() => 'fixture-runtime'),
    requireWorkbenchWorkspace: vi.fn(() => FIXTURE_ONLY_WORKSPACE),
    getOrchestrationDb: vi.fn(() => h.owner)
  }
}

/** A validation backlog pass can start a reviewer CLI, so a refused caller must never reach it. */
function backlogSpy(runtime: ReturnType<typeof fixtureRuntime>) {
  const checkBacklog = vi.fn(async () => ({
    checked: 0,
    passed: 0,
    failed: 0,
    inconclusive: 0,
    skipped: 0
  }))
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the registry only uses the runtime as a WeakMap key.
  const unregister = registerValidationBacklogPort(runtime as never, { checkBacklog })
  return { checkBacklog, unregister }
}

function request(method: string, extra: Record<string, unknown> = {}): RpcRequest {
  return {
    id: 'fixture-request',
    authToken: 'fixture-local-token',
    method,
    params: METHOD_PARAMS[method],
    ...extra
  }
}

describe('workbench method registry', () => {
  it('lists every workbench method it registers, so no method skips the refusal checks below', () => {
    const registered = ALL_RPC_METHODS.map((method) => method.name)
      .filter((name) => name.startsWith('workbench.'))
      .sort()
    expect(registered).toEqual(Object.keys(METHOD_PARAMS).sort())
    for (const name of ADMINISTRATION_METHODS) {
      expect(WORKBENCH_METHODS.map((method) => method.name)).toContain(name)
    }
  })

  it('uses params each method accepts, so every refusal below comes from the caller check', () => {
    for (const method of ALL_RPC_METHODS.filter((entry) => entry.name in D016_METHOD_PARAMS)) {
      const sample = D016_METHOD_PARAMS[method.name]
      expect(method.params?.safeParse(sample).success ?? sample === undefined, method.name).toBe(
        true
      )
    }
  })

  it('does not register the retired intake routing methods', () => {
    const registered = ALL_RPC_METHODS.map((method) => method.name)
    for (const name of RETIRED_METHODS) {
      expect(registered).not.toContain(name)
    }
  })

  it('keeps every workbench method off the mobile allowlist', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/main/runtime/runtime-rpc/runtime-rpc-mobile-method-allowlist.ts'),
      'utf8'
    )
    expect(source).not.toMatch(/'workbench\./)
  })
})

describe('every workbench method refuses a caller that is not the trusted desktop renderer', () => {
  it.each(CALLERS)(
    'refuses %s for each method before admission, a call or a write',
    async (_who, options) => {
      const h = harness
      if (h === null) {
        throw new Error('harness')
      }
      const runtime = fixtureRuntime(h)
      const backlog = backlogSpy(runtime)
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only the exercised Workbench methods read this fixture's runtime members.
      const dispatcher = new RpcDispatcher({ runtime: runtime as never, methods: ALL_RPC_METHODS })
      for (const method of Object.keys(METHOD_PARAMS)) {
        const response = await dispatcher.dispatch(request(method), options)
        expect(response, `${method} for ${_who}`).toMatchObject({
          ok: false,
          error: { code: 'workbench_forbidden' }
        })
      }
      backlog.unregister()
      expect(backlog.checkBacklog).not.toHaveBeenCalled()
      expect(runtime.requireWorkbenchWorkspace).not.toHaveBeenCalled()
      expect(runtime.getOrchestrationDb).not.toHaveBeenCalled()
      for (const spy of spies) {
        expect(spy).not.toHaveBeenCalled()
      }
      // The paid path: no Clef call, no reservation and no raw response.
      expect(h.transport).not.toHaveBeenCalled()
      expect(h.spendRows()).toEqual([])
      expect(h.rawRows()).toEqual([])
    }
  )

  it('ignores a caller object smuggled into the request envelope', async () => {
    const h = harness
    if (h === null) {
      throw new Error('harness')
    }
    const runtime = fixtureRuntime(h)
    const backlog = backlogSpy(runtime)
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only the exercised Workbench methods read this fixture's runtime members.
    const dispatcher = new RpcDispatcher({ runtime: runtime as never, methods: ALL_RPC_METHODS })
    for (const method of Object.keys(METHOD_PARAMS)) {
      const envelope = request(method, {
        workbenchCaller: issueWorkbenchDesktopCaller(),
        principalId: 'local-desktop-ui'
      })
      expect(await dispatcher.dispatch(envelope)).toMatchObject({
        ok: false,
        error: { code: 'workbench_forbidden' }
      })
    }
    backlog.unregister()
    expect(backlog.checkBacklog).not.toHaveBeenCalled()
    expect(h.transport).not.toHaveBeenCalled()
    expect(h.spendRows()).toEqual([])
  })

  it('still serves the trusted desktop caller, so the refusals above are not a broken fixture', async () => {
    const h = harness
    if (h === null) {
      throw new Error('harness')
    }
    const runtime = fixtureRuntime(h)
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only the exercised Workbench methods read this fixture's runtime members.
    const dispatcher = new RpcDispatcher({ runtime: runtime as never, methods: ALL_RPC_METHODS })
    const response = await dispatcher.dispatch(request('workbench.routing.status'), {
      workbenchCaller: issueWorkbenchDesktopCaller()
    })
    expect(response).toMatchObject({ ok: true })
    expect(installed.routingStatusView).toHaveBeenCalledTimes(1)
  })
})

describe('the trusted caller has exactly one issuer', () => {
  it('is issued only by the desktop IPC handler that checks the trusted renderer', () => {
    const root = join(process.cwd(), 'src')
    const callers = readdirSync(root, { recursive: true, encoding: 'utf8' })
      .map((path) => path.split(sep).join('/'))
      .filter((path) => /\.(?:ts|tsx)$/.test(path) && !/\.(?:test|spec)\.tsx?$/.test(path))
      .filter((path) =>
        readFileSync(join(root, path), 'utf8').includes('issueWorkbenchDesktopCaller')
      )
    expect(callers.sort()).toEqual(['main/ipc/runtime.ts', 'main/runtime/workbench-caller.ts'])
  })
})
