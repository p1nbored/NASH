import { describe, expect, it, vi } from 'vitest'
import { MOBILE_RPC_METHOD_ALLOWLIST } from '../runtime-rpc/runtime-rpc-mobile-method-allowlist'
import { issueDotIngressCaller } from '../dot-ingress/dot-ingress-caller'
import { issueWorkbenchDesktopCaller } from '../workbench-caller'
import type { RpcRequest } from './core'
import { RpcDispatcher } from './dispatcher'
import { ALL_RPC_METHODS } from './methods'
import { DOT_INGRESS_RPC_METHODS } from './methods/dot-ingress'
import { WORKBENCH_METHODS } from './methods/workbench'

const DOT_PREFIX = 'dotIngress.'
const DOT_NAMES = DOT_INGRESS_RPC_METHODS.map((method) => method.name)

// FIXTURE_ONLY: a runtime that records any access, so a refused request provably reached no handler.
function recordingRuntime() {
  const touched: string[] = []
  let armed = false
  const target = { getRuntimeId: () => 'runtime-fixture-1', getOrchestrationDb: vi.fn() }
  const runtime = new Proxy(target, {
    get(object, property, receiver) {
      if (armed && typeof property === 'string' && property !== 'getRuntimeId') {
        touched.push(property)
      }
      return Reflect.get(object, property, receiver)
    }
  })
  return {
    runtime,
    touched,
    arm: () => {
      armed = true
    }
  }
}

function request(method: string): RpcRequest {
  return { id: `req-${method}`, authToken: '', method, params: { contractVersion: 1 } }
}

describe('dot ingress method registry', () => {
  it('keeps every dotIngress method out of the full registry', () => {
    const fullNames: ReadonlySet<string> = new Set(ALL_RPC_METHODS.map((method) => method.name))

    expect(DOT_NAMES.every((name) => name.startsWith(DOT_PREFIX))).toBe(true)
    expect(DOT_NAMES.some((name) => fullNames.has(name))).toBe(false)
    expect([...fullNames].some((name) => name.startsWith(DOT_PREFIX))).toBe(false)
  })

  it('keeps every dotIngress method off the mobile and remote allowlist', () => {
    expect([...MOBILE_RPC_METHOD_ALLOWLIST].some((name) => name.startsWith(DOT_PREFIX))).toBe(false)
  })

  it('makes the full registry answer method_not_found for every ingress name', async () => {
    const { runtime, arm } = recordingRuntime()
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a refused lookup never reads the runtime.
    const full = new RpcDispatcher({ runtime: runtime as never, methods: ALL_RPC_METHODS })
    arm()

    for (const name of DOT_NAMES) {
      expect(await full.dispatch(request(name))).toMatchObject({
        ok: false,
        error: { code: 'method_not_found' }
      })
    }
  })

  it('answers method_not_found for every name in ALL_RPC_METHODS on the ingress dispatcher', async () => {
    const { runtime, touched, arm } = recordingRuntime()
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a refused lookup never reads the runtime.
    const ingress = new RpcDispatcher({
      runtime: runtime as never,
      methods: DOT_INGRESS_RPC_METHODS
    })
    arm()
    const callers = [
      { dotIngressCaller: issueDotIngressCaller() },
      { workbenchCaller: issueWorkbenchDesktopCaller() },
      {}
    ]
    const wrong: string[] = []

    for (const method of ALL_RPC_METHODS) {
      for (const options of callers) {
        const response = await ingress.dispatch(request(method.name), options)
        if (response.ok || response.error.code !== 'method_not_found') {
          wrong.push(method.name)
        }
      }
    }

    expect(ALL_RPC_METHODS.length).toBeGreaterThan(500)
    expect(wrong).toEqual([])
    expect(touched).toEqual([])
  })

  it.each([
    'status.get',
    'terminal.send',
    'settings.update',
    'workbench.requests.submit',
    'workbench.clef.verify',
    'workbench.clef.profile.pin',
    'workbench.dotIngress.settings.set',
    'orchestration.run'
  ])('answers method_not_found for %s on the ingress dispatcher', async (name) => {
    const { runtime } = recordingRuntime()
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a refused lookup never reads the runtime.
    const ingress = new RpcDispatcher({
      runtime: runtime as never,
      methods: DOT_INGRESS_RPC_METHODS
    })

    expect(
      await ingress.dispatch(request(name), { dotIngressCaller: issueDotIngressCaller() })
    ).toMatchObject({ ok: false, error: { code: 'method_not_found' } })
  })
})

// Why: params must parse before a handler runs, so each desktop method needs valid ones to reach its caller gate.
const WORKSPACE_ID = 'worktree:repo::c:/WORK/REPO'
const VALID_PARAMS: Record<string, unknown> = {
  'workbench.requests.submit': {
    workspaceId: WORKSPACE_ID,
    objective: 'Inspect this change.',
    idempotencyKey: '8f18f989-8a86-423e-8e45-3416e01a14d2'
  },
  'workbench.requests.list': { workspaceId: WORKSPACE_ID, limit: 10 },
  'workbench.requests.cancel': {
    workspaceId: WORKSPACE_ID,
    requestId: 'request-one',
    expectedRevision: 1
  },
  'workbench.clef.profile.pin': { reportSha256: 'a'.repeat(64) }
}
// The dispatcher itself consults the runtime for client-hosted browser routing before any handler runs.
const DISPATCHER_OWN_ACCESS = ['routeClientHostedBrowserRpc']

describe('dot ingress caller isolation from the desktop methods', () => {
  it.each(WORKBENCH_METHODS.map((method) => method.name))(
    'refuses the dot caller on %s with workbench_forbidden and no workspace or database access',
    async (name) => {
      const { runtime, touched, arm } = recordingRuntime()
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the caller gate refuses before the handler reads the runtime.
      const workbench = new RpcDispatcher({ runtime: runtime as never, methods: WORKBENCH_METHODS })
      arm()

      const response = await workbench.dispatch(
        { id: 'req-1', authToken: '', method: name, params: VALID_PARAMS[name] ?? {} },
        { dotIngressCaller: issueDotIngressCaller() }
      )

      expect(response).toMatchObject({ ok: false, error: { code: 'workbench_forbidden' } })
      expect(touched.filter((access) => !DISPATCHER_OWN_ACCESS.includes(access))).toEqual([])
    }
  )

  it('refuses the desktop caller on the dot method without any workspace or database access', async () => {
    const { runtime, touched, arm } = recordingRuntime()
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the caller gate refuses before the handler reads the runtime.
    const ingress = new RpcDispatcher({
      runtime: runtime as never,
      methods: DOT_INGRESS_RPC_METHODS
    })
    arm()

    const response = await ingress.dispatch(request('dotIngress.hello'), {
      workbenchCaller: issueWorkbenchDesktopCaller()
    })

    expect(response.ok).toBe(false)
    expect(touched.filter((access) => !DISPATCHER_OWN_ACCESS.includes(access))).toEqual([])
  })
})
