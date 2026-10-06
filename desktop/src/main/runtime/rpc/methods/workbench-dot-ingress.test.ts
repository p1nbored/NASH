import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  WorkbenchDotIngressRequestsListResultSchema,
  WorkbenchDotIngressSettingsResultSchema,
  WORKBENCH_DOT_INGRESS_FAILURES
} from '../../../../shared/rpc-contract/workbench-dot-ingress-params'
import { DOT_INGRESS_FAILURES } from '../../dot-ingress/dot-ingress-control'
import { issueDotIngressCaller } from '../../dot-ingress/dot-ingress-caller'
import { submitDotRequest } from '../../dot-ingress/dot-ingress-intake'
import {
  FIXTURE_BINDING,
  FIXTURE_OBJECTIVE,
  FIXTURE_WORKSPACE,
  createDotHarness,
  type DotHarness
} from '../../dot-ingress/dot-ingress-service.test-fixture'
import { getDotIngressSettingsStore } from '../../orchestration/db/dot-ingress-settings-store'
import { OrchestrationError } from '../../orchestration/orchestration-error'
import { issueWorkbenchDesktopCaller } from '../../workbench-caller'
import type { RpcContext } from '../core'
import { WORKBENCH_DOT_INGRESS_METHODS } from './workbench-dot-ingress'

type FakeControl = { sync: ReturnType<typeof vi.fn>; status: ReturnType<typeof vi.fn> }

async function rejectionCode(operation: () => unknown): Promise<string | null> {
  try {
    await operation()
    return null
  } catch (error) {
    return error instanceof OrchestrationError ? error.code : `unexpected: ${String(error)}`
  }
}

describe('desktop dot interface methods (workbench.dotIngress.*)', () => {
  let harness: DotHarness
  let control: FakeControl | null
  let runtime: {
    getOrchestrationDb: ReturnType<typeof vi.fn>
    requireWorkbenchWorkspace: ReturnType<typeof vi.fn>
    requireDotIngressControl: () => FakeControl
  }

  beforeEach(() => {
    harness = createDotHarness({ enabled: false })
    control = {
      sync: vi.fn(async () => ({
        enabled: getDotIngressSettingsStore(harness.owner).getSettings().enabled,
        listening: getDotIngressSettingsStore(harness.owner).getSettings().enabled,
        failure: null
      })),
      status: vi.fn(() => ({ enabled: false, listening: false, failure: 'listen_failed' }))
    }
    runtime = {
      getOrchestrationDb: vi.fn(() => harness.owner),
      requireWorkbenchWorkspace: vi.fn(() => FIXTURE_WORKSPACE),
      requireDotIngressControl: () => {
        if (!control) {
          throw new OrchestrationError('workbench_dot_ingress_unavailable', 'Fixture control off.')
        }
        return control
      }
    }
  })
  afterEach(() => harness.close())

  function invoke(name: string, params: unknown, caller: Partial<RpcContext> = {}) {
    const method = WORKBENCH_DOT_INGRESS_METHODS.find((entry) => entry.name === name)
    if (!method) {
      throw new Error(`no method ${name}`)
    }
    const context: RpcContext = {
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the methods read only the members this fixture provides.
      runtime: runtime as never,
      workbenchCaller: issueWorkbenchDesktopCaller(),
      ...caller
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: each case passes the params its method parses.
    return method.handler(
      (method.params ? method.params.parse(params) : undefined) as never,
      context
    )
  }

  it('names every method workbench.dotIngress.* and keeps them unary', () => {
    expect(WORKBENCH_DOT_INGRESS_METHODS.map((method) => method.name)).toEqual([
      'workbench.dotIngress.settings.get',
      'workbench.dotIngress.settings.setEnabled',
      'workbench.dotIngress.settings.setRateLimits',
      'workbench.dotIngress.workspaces.enable',
      'workbench.dotIngress.workspaces.disable',
      'workbench.dotIngress.requests.list'
    ])
    expect(WORKBENCH_DOT_INGRESS_METHODS.some((method) => 'stream' in method)).toBe(false)
  })

  it('mirrors the failure codes of the ingress control port', () => {
    expect([...WORKBENCH_DOT_INGRESS_FAILURES]).toEqual([...DOT_INGRESS_FAILURES])
  })

  it.each([
    ['no caller', {}],
    ['the dot caller', { workbenchCaller: undefined, dotIngressCaller: issueDotIngressCaller() }]
  ])('refuses every method for %s before reading the runtime', async (_name, caller) => {
    const params = {
      'workbench.dotIngress.settings.get': undefined,
      'workbench.dotIngress.settings.setEnabled': { enabled: true },
      'workbench.dotIngress.settings.setRateLimits': { ratePerMinute: 1, ratePerUtcDay: 1 },
      'workbench.dotIngress.workspaces.enable': {
        workspaceId: FIXTURE_WORKSPACE.workspaceId,
        label: 'x'
      },
      'workbench.dotIngress.workspaces.disable': { workspaceRef: harness.workspaceRef },
      'workbench.dotIngress.requests.list': {}
    }
    for (const [name, value] of Object.entries(params)) {
      const context = { workbenchCaller: undefined, ...caller }
      expect(await rejectionCode(() => invoke(name, value, context)), name).toBe(
        'workbench_forbidden'
      )
    }
    expect(runtime.getOrchestrationDb).not.toHaveBeenCalled()
  })

  it('writes the switch, then aligns the endpoint and reports what it does', async () => {
    const result = WorkbenchDotIngressSettingsResultSchema.parse(
      await invoke('workbench.dotIngress.settings.setEnabled', { enabled: true })
    )
    expect(control?.sync).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      enabled: true,
      connection: 'not_connected',
      listening: true,
      failure: null
    })
  })

  it('reports the endpoint as not listening while the control port is not installed', async () => {
    control = null
    const result = WorkbenchDotIngressSettingsResultSchema.parse(
      await invoke('workbench.dotIngress.settings.get', undefined)
    )
    expect(result).toMatchObject({ enabled: false, listening: false, failure: null })
  })

  it('enables a workspace for dot with the ceiling the user chose, re-admitting it first', async () => {
    const result = WorkbenchDotIngressSettingsResultSchema.parse(
      await invoke('workbench.dotIngress.workspaces.enable', {
        workspaceId: FIXTURE_WORKSPACE.workspaceId,
        label: 'fixture-repo',
        maxAccess: 'workspace_write'
      })
    )
    expect(runtime.requireWorkbenchWorkspace).toHaveBeenCalledWith(FIXTURE_WORKSPACE.workspaceId)
    expect(result.workspaces).toEqual([
      {
        workspaceRef: harness.workspaceRef,
        workspaceId: FIXTURE_WORKSPACE.workspaceId,
        label: 'fixture-repo',
        enabled: true,
        maxAccess: 'workspace_write'
      }
    ])
    expect(
      getDotIngressSettingsStore(harness.owner).getWorkspace(harness.workspaceRef)
    ).toMatchObject({
      workspaceBinding: FIXTURE_BINDING
    })
  })

  it('disables a workspace and changes the caps', async () => {
    await invoke('workbench.dotIngress.workspaces.disable', { workspaceRef: harness.workspaceRef })
    const result = WorkbenchDotIngressSettingsResultSchema.parse(
      await invoke('workbench.dotIngress.settings.setRateLimits', {
        ratePerMinute: 3,
        ratePerUtcDay: 30
      })
    )
    expect(result.rateLimits).toEqual({ ratePerMinute: 3, ratePerUtcDay: 30 })
    expect(result.workspaces[0]).toMatchObject({ enabled: false, maxAccess: 'read_only' })
  })

  it('shows the desktop each dot request with its objective, claim and coarse run state', async () => {
    getDotIngressSettingsStore(harness.owner).setEnabled({
      enabled: true,
      timestamp: '2026-10-05T00:00:10.000Z'
    })
    const { record } = await submitDotRequest(
      harness.deps,
      harness.submitRequest({ client: { name: 'dot', version: '1.0.0' } })
    )
    const result = WorkbenchDotIngressRequestsListResultSchema.parse(
      await invoke('workbench.dotIngress.requests.list', {})
    )
    expect(result).toEqual({
      requests: [
        expect.objectContaining({
          dotRequestId: record.dotRequestId,
          state: 'submitted',
          workspaceId: FIXTURE_WORKSPACE.workspaceId,
          objective: FIXTURE_OBJECTIVE,
          claimedClient: { name: 'dot', version: '1.0.0' },
          run: { state: 'active', blocker: null }
        })
      ],
      nextBeforeSequence: null
    })
  })
})
