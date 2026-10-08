import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DotDecisionsListResultSchema } from '../../../../shared/dot-ingress/dot-ingress-decision'
import { DotMessageResultSchema } from '../../../../shared/dot-ingress/dot-ingress-message'
import {
  DotCancelResultSchema,
  DotStatusResultSchema,
  DotWorkspacesResultSchema,
  DotListResultSchema,
  DotSubmitResultSchema
} from '../../../../shared/dot-ingress/dot-ingress-request'

import {
  DOT_INGRESS_METHOD_NAMES,
  type DotIngressMethodName
} from '../../../../shared/dot-ingress/dot-ingress-versions'
import { issueDotIngressCaller } from '../../dot-ingress/dot-ingress-caller'
import { dotRefusal } from '../../dot-ingress/dot-ingress-refusals'
import {
  FIXTURE_BINDING,
  FIXTURE_OBJECTIVE,
  FIXTURE_WORKSPACE,
  fixtureUuid
} from '../../dot-ingress/dot-ingress-service.test-fixture'
import { getDotIngressSettingsStore } from '../../orchestration/db/dot-ingress-settings-store'
import { OrchestrationDb } from '../../orchestration/db'
import { OrchestrationError } from '../../orchestration/orchestration-error'
import { issueWorkbenchDesktopCaller } from '../../workbench-caller'
import { settleWorkbenchLaunches } from '../../workbench-intake-launch'
import type { RpcContext } from '../core'
import { RpcDispatcher } from '../dispatcher'
import { DOT_INGRESS_RPC_METHODS } from './dot-ingress'

const NOW = '2026-10-05T00:00:10.000Z'

async function rejection(operation: () => unknown): Promise<OrchestrationError | null> {
  try {
    await operation()
    return null
  } catch (error) {
    if (error instanceof OrchestrationError) {
      return error
    }
    throw error
  }
}

describe('dot ingress RPC surface (current contract)', () => {
  let owner: OrchestrationDb
  let runtime: {
    getRuntimeId: () => string
    getOrchestrationDb: ReturnType<typeof vi.fn>
    requireWorkbenchWorkspace: ReturnType<typeof vi.fn>
  }
  let dispatcher: RpcDispatcher
  let workspaceRef: string

  beforeEach(() => {
    owner = new OrchestrationDb(':memory:')
    runtime = {
      getRuntimeId: () => 'runtime-fixture-1',
      getOrchestrationDb: vi.fn(() => owner),
      requireWorkbenchWorkspace: vi.fn(() => FIXTURE_WORKSPACE)
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the dot methods read only the members this fixture provides.
    dispatcher = new RpcDispatcher({ runtime: runtime as never, methods: DOT_INGRESS_RPC_METHODS })
    const settings = getDotIngressSettingsStore(owner)
    settings.setEnabled({ enabled: true, timestamp: NOW })
    workspaceRef = settings.enableWorkspace({
      workspaceId: FIXTURE_WORKSPACE.workspaceId,
      workspaceBinding: FIXTURE_BINDING,
      label: 'fixture-repo',
      timestamp: NOW
    }).workspace.workspaceRef
  })
  // The real door launches on the next turn; settle it while the database is still open.
  afterEach(async () => {
    await settleWorkbenchLaunches()
    owner.close()
  })

  async function call(method: string, params: Record<string, unknown>): Promise<unknown> {
    const response = await dispatcher.dispatch(
      { id: `req-${method}`, authToken: '', method, params },
      { dotIngressCaller: issueDotIngressCaller() }
    )
    if (!response.ok) {
      throw new Error(`${method} failed: ${response.error.code}`)
    }
    return response.result
  }

  function handlerOf(name: string) {
    const method = DOT_INGRESS_RPC_METHODS.find((entry) => entry.name === name)
    if (!method) {
      throw new Error(`no method ${name}`)
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: params are refused by the handler's own checks under test.
    return (params: unknown, context: RpcContext) => method.handler(params as never, context)
  }

  function dotContext(): RpcContext {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the dot methods read only the members this fixture provides.
    return { runtime: runtime as never, dotIngressCaller: issueDotIngressCaller() }
  }

  it.each(DOT_INGRESS_METHOD_NAMES)(
    '%s refuses an unsupported version, naming every served one',
    async (name) => {
      const refused = await rejection(() => handlerOf(name)({ contractVersion: 4 }, dotContext()))
      expect(refused?.code).toBe('dot_unsupported_contract_version')
      expect(refused?.message).toBe('Unsupported contract version. Supported versions: 3.')
    }
  )

  it.each(DOT_INGRESS_METHOD_NAMES)(
    '%s refuses a missing, copied or desktop caller before reading the runtime',
    async (name) => {
      const issued = issueDotIngressCaller()
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the runtime is never read on a refused call.
      const base = { runtime: runtime as never }
      const contexts: RpcContext[] = [
        base,
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a plain copy stands in for a forged caller.
        { ...base, dotIngressCaller: { ...issued } as never },
        { ...base, workbenchCaller: issueWorkbenchDesktopCaller() }
      ]
      for (const context of contexts) {
        const refused = await rejection(() => handlerOf(name)({ contractVersion: 3 }, context))
        expect(refused?.code).toBe('dot_ingress_forbidden')
      }
      expect(runtime.getOrchestrationDb).not.toHaveBeenCalled()
    }
  )

  it('submits, reads, lists and cancels through the single door', async () => {
    const submitted = DotSubmitResultSchema.parse(
      await call('dotIngress.requests.submit', {
        contractVersion: 3,
        workspaceRef,
        objective: FIXTURE_OBJECTIVE,
        idempotencyKey: fixtureUuid(1)
      })
    )
    expect(submitted.request).toMatchObject({
      state: 'submitted',
      requestedAccess: 'read_only',
      run: { state: 'not_started', blocker: null }
    })
    const id = submitted.request.dotRequestId
    const status = DotStatusResultSchema.parse(
      await call('dotIngress.requests.status', { contractVersion: 3, dotRequestId: id })
    )
    expect(status.request.state).toBe('submitted')
    const listed = DotListResultSchema.parse(
      await call('dotIngress.requests.list', { contractVersion: 3 })
    )
    expect(listed.requests.map((request) => request.dotRequestId)).toEqual([id])
    const canceled = DotCancelResultSchema.parse(
      await call('dotIngress.requests.cancel', { contractVersion: 3, dotRequestId: id })
    )
    expect(canceled).toMatchObject({ changed: true, request: { state: 'canceled', run: null } })
    // Passive: a dot call must not start the old federation or coordinator delivery pumps.
    const reads: unknown[] = runtime.getOrchestrationDb.mock.calls.map((args: unknown[]) => args[0])
    expect(reads.length).toBeGreaterThan(0)
    expect(reads.every((options) => JSON.stringify(options) === '{"passive":true}')).toBe(true)
  })

  it('lists workspaces with their access ceiling', async () => {
    expect(
      DotWorkspacesResultSchema.parse(
        await call('dotIngress.workspaces.list', { contractVersion: 3 })
      ).workspaces
    ).toEqual([{ workspaceRef, label: 'fixture-repo', maxAccess: 'read_only' }])
  })

  it('lists no prompts while no relay runs, and refuses an unknown prompt', async () => {
    expect(
      DotDecisionsListResultSchema.parse(
        await call('dotIngress.decisions.list', { contractVersion: 3 })
      )
    ).toEqual({ contractVersion: 3, decisions: [] })
    const refused = await rejection(() =>
      handlerOf('dotIngress.decisions.answer')(
        { contractVersion: 3, decisionId: fixtureUuid(7), decision: 'deny' },
        dotContext()
      )
    )
    expect(refused?.code).toBe('dot_decision_not_found')
  })

  it('refuses a follow-up message to a request that has no run yet', async () => {
    const submitted = DotSubmitResultSchema.parse(
      await call('dotIngress.requests.submit', {
        contractVersion: 3,
        workspaceRef,
        objective: FIXTURE_OBJECTIVE,
        idempotencyKey: fixtureUuid(1)
      })
    )
    const result = DotMessageResultSchema.parse(
      await call('dotIngress.requests.message', {
        contractVersion: 3,
        dotRequestId: submitted.request.dotRequestId,
        messageId: fixtureUuid(2),
        text: 'Also list the owners.'
      })
    )
    expect(result).toEqual({
      contractVersion: 3,
      dotRequestId: submitted.request.dotRequestId,
      messageId: fixtureUuid(2),
      outcome: 'refused',
      reason: 'run_not_started',
      duplicate: false
    })
  })

  it('refuses unknown fields in the current version as an invalid argument', async () => {
    for (const contractVersion of [3]) {
      const response = await dispatcher.dispatch(
        {
          id: 'req-strict',
          authToken: '',
          method: 'dotIngress.requests.submit',
          params: {
            contractVersion,
            workspaceRef,
            objective: FIXTURE_OBJECTIVE,
            idempotencyKey: fixtureUuid(1),
            approved: true
          }
        },
        { dotIngressCaller: issueDotIngressCaller() }
      )
      expect(response).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    }
    expect(owner.db.prepare('SELECT count(*) AS n FROM dot_ingress_requests').get()).toEqual({
      n: 0
    })
  })

  it('refuses an access above the ceiling with its current code', async () => {
    const submit = (contractVersion: number, key: number) =>
      rejection(() =>
        handlerOf('dotIngress.requests.submit')(
          {
            contractVersion,
            workspaceRef,
            objective: FIXTURE_OBJECTIVE,
            idempotencyKey: fixtureUuid(key),
            requestedAccess: 'workspace_write'
          },
          dotContext()
        )
      )
    const data = { reason: 'access_above_workspace_maximum', maxAccess: 'read_only' }
    expect(await submit(3, 1)).toMatchObject({ code: 'dot_access_above_maximum', data })
  })

  function validParams(name: DotIngressMethodName): Record<string, unknown> {
    const byMethod: Record<DotIngressMethodName, Record<string, unknown>> = {
      'dotIngress.hello': {},
      'dotIngress.workspaces.list': {},
      'dotIngress.requests.submit': {
        workspaceRef,
        objective: FIXTURE_OBJECTIVE,
        idempotencyKey: fixtureUuid(1)
      },
      'dotIngress.requests.status': { dotRequestId: fixtureUuid(1) },
      'dotIngress.requests.list': {},
      'dotIngress.requests.cancel': { dotRequestId: fixtureUuid(1) },
      'dotIngress.requests.message': {
        dotRequestId: fixtureUuid(1),
        messageId: fixtureUuid(2),
        text: 'Also list the owners.'
      },
      'dotIngress.decisions.list': {},
      'dotIngress.decisions.answer': { decisionId: fixtureUuid(3), decision: 'deny' },
      'dotIngress.validations.list': {},
      'dotIngress.validations.decide': {
        decisionId: fixtureUuid(4),
        validationId: 'validation_fixture',
        decision: 'waive'
      }
    }
    return byMethod[name]
  }

  function failEveryDatabaseRead(): void {
    runtime.getOrchestrationDb.mockImplementation(() => {
      throw dotRefusal('dot_request_busy', { reason: 'request_changed' })
    })
  }

  it.each(DOT_INGRESS_METHOD_NAMES)(
    '%s passes the current refusal code unchanged',
    async (name) => {
      failEveryDatabaseRead()
      const refused = await rejection(() =>
        handlerOf(name)({ contractVersion: 3, ...validParams(name) }, dotContext())
      )
      expect(refused).toMatchObject({
        code: 'dot_request_busy',
        data: { reason: 'request_changed' }
      })
    }
  )

  it('never returns the objective, the workspace id or a path in any response', async () => {
    const responses = [
      await call('dotIngress.requests.submit', {
        contractVersion: 3,
        workspaceRef,
        objective: FIXTURE_OBJECTIVE,
        idempotencyKey: fixtureUuid(1)
      }),
      await call('dotIngress.requests.list', { contractVersion: 3 }),
      await call('dotIngress.workspaces.list', { contractVersion: 3 }),
      await call('dotIngress.hello', { contractVersion: 3 })
    ]
    const text = JSON.stringify(responses)
    expect(text).not.toContain('Summarize the open issues')
    expect(text).not.toContain(FIXTURE_WORKSPACE.workspaceId)
    expect(text).not.toContain(FIXTURE_WORKSPACE.path)
  })
})
