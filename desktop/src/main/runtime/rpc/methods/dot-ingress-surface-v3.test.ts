import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DotHelloResultV2Schema } from '../../../../shared/dot-ingress/dot-ingress-v2'
import {
  DotDecisionsListResultV3Schema,
  DotHelloResultV3Schema,
  DotListResultV3Schema,
  DotMessageResultV3Schema,
  DotStatusResultV3Schema,
  DotWorkspacesResultV3Schema
} from '../../../../shared/dot-ingress/dot-ingress-v3'
import {
  DotValidationDecideResultV3Schema,
  DotValidationsListResultV3Schema
} from '../../../../shared/dot-ingress/dot-ingress-validation'
import {
  DOT_INGRESS_METHOD_NAMES,
  DOT_INGRESS_V2_METHOD_NAMES
} from '../../../../shared/dot-ingress/dot-ingress-versions'
import { issueDotIngressCaller } from '../../dot-ingress/dot-ingress-caller'
import { submitDotRequest } from '../../dot-ingress/dot-ingress-intake'
import {
  createDotHarness,
  fixtureUuid,
  type DotHarness
} from '../../dot-ingress/dot-ingress-service.test-fixture'
import { dotStartedRun } from '../../dot-ingress/dot-ingress-validation.test-fixture'
import {
  FIXTURE_REASON,
  inconclusiveAttempt
} from '../../task-validation/validation-decision.test-fixture'
import { RpcDispatcher } from '../dispatcher'
import { DOT_INGRESS_RPC_METHODS } from './dot-ingress'

describe('dot ingress RPC surface, contract version 3', () => {
  let dot: DotHarness
  let runtime: {
    getRuntimeId: () => string
    getOrchestrationDb: ReturnType<typeof vi.fn>
    requireWorkbenchWorkspace: ReturnType<typeof vi.fn>
    notifyMessageArrived: ReturnType<typeof vi.fn>
  }
  let dispatcher: RpcDispatcher

  beforeEach(() => {
    dot = createDotHarness()
    runtime = {
      getRuntimeId: () => 'runtime-fixture-1',
      getOrchestrationDb: vi.fn(() => dot.owner),
      requireWorkbenchWorkspace: vi.fn(),
      notifyMessageArrived: vi.fn()
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the dot methods read only the members this fixture provides.
    dispatcher = new RpcDispatcher({ runtime: runtime as never, methods: DOT_INGRESS_RPC_METHODS })
  })
  afterEach(() => dot.close())

  async function respond(method: string, params: Record<string, unknown>) {
    return dispatcher.dispatch(
      { id: `req-${method}`, authToken: '', method, params },
      { dotIngressCaller: issueDotIngressCaller() }
    )
  }

  async function call(method: string, params: Record<string, unknown>): Promise<unknown> {
    const response = await respond(method, params)
    if (!response.ok) {
      throw new Error(`${method} failed: ${response.error.code}`)
    }
    return response.result
  }

  async function code(method: string, params: Record<string, unknown>): Promise<string | null> {
    const response = await respond(method, params)
    return response.ok ? null : response.error.code
  }

  it('says hello in version 3 with every method; versions 1 and 2 never see the new ones', async () => {
    const v3 = DotHelloResultV3Schema.parse(await call('dotIngress.hello', { contractVersion: 3 }))
    expect(v3.supportedContractVersions).toEqual([1, 2, 3])
    expect(v3.methods).toEqual(DOT_INGRESS_RPC_METHODS.map((method) => method.name))
    expect(v3.methods).toEqual([...DOT_INGRESS_METHOD_NAMES])
    expect(v3.capabilities.validationDecisions).toBe(true)
    expect(v3.limits).toMatchObject({
      maxValidationTitleChars: 200,
      maxValidationSummaryChars: 500
    })
    const v2 = DotHelloResultV2Schema.parse(await call('dotIngress.hello', { contractVersion: 2 }))
    expect(v2.supportedContractVersions).toEqual([1, 2])
    expect(v2.methods).toEqual([...DOT_INGRESS_V2_METHOD_NAMES])
  })

  it('answers every version 2 method in version 3', async () => {
    const { record } = await submitDotRequest(dot.deps, dot.submitRequest())
    const id = record.dotRequestId
    expect(
      DotStatusResultV3Schema.parse(
        await call('dotIngress.requests.status', { contractVersion: 3, dotRequestId: id })
      ).request.contractVersion
    ).toBe(3)
    expect(
      DotListResultV3Schema.parse(
        await call('dotIngress.requests.list', { contractVersion: 3 })
      ).requests.map((request) => request.dotRequestId)
    ).toEqual([id])
    expect(
      DotWorkspacesResultV3Schema.parse(
        await call('dotIngress.workspaces.list', { contractVersion: 3 })
      ).workspaces
    ).toEqual([{ workspaceRef: dot.workspaceRef, label: 'fixture-repo', maxAccess: 'read_only' }])
    expect(
      DotDecisionsListResultV3Schema.parse(
        await call('dotIngress.decisions.list', { contractVersion: 3 })
      )
    ).toEqual({ contractVersion: 3, decisions: [] })
    expect(
      DotMessageResultV3Schema.parse(
        await call('dotIngress.requests.message', {
          contractVersion: 3,
          dotRequestId: id,
          messageId: fixtureUuid(50),
          text: 'Also list the owners.'
        })
      )
    ).toMatchObject({ contractVersion: 3, outcome: 'refused', reason: 'primary_not_live' })
  })

  it('serves the validation methods from version 3 only', async () => {
    for (const contractVersion of [1, 2]) {
      expect(await code('dotIngress.validations.list', { contractVersion })).toBe(
        'dot_unsupported_contract_version'
      )
      expect(
        await code('dotIngress.validations.decide', {
          contractVersion,
          decisionId: fixtureUuid(9),
          validationId: 'validation_x',
          decision: 'waive'
        })
      ).toBe('dot_unsupported_contract_version')
    }
    expect(
      DotValidationsListResultV3Schema.parse(
        await call('dotIngress.validations.list', { contractVersion: 3 })
      )
    ).toEqual({ contractVersion: 3, validations: [], hasMore: false })
  })

  it('lists and decides a waiting result of a run dot started, once per decision id', async () => {
    const run = await dotStartedRun(dot)
    const task = inconclusiveAttempt(run.harness)
    const listed = DotValidationsListResultV3Schema.parse(
      await call('dotIngress.validations.list', {
        contractVersion: 3,
        dotRequestId: run.dotRequestId
      })
    )
    expect(listed.validations).toEqual([
      expect.objectContaining({
        validationId: task.validationId,
        dotRequestId: run.dotRequestId,
        reason: 'checks_inconclusive',
        summary: FIXTURE_REASON
      })
    ])
    const params = {
      contractVersion: 3,
      decisionId: fixtureUuid(60),
      validationId: task.validationId,
      decision: 'waive'
    }
    const decided = DotValidationDecideResultV3Schema.parse(
      await call('dotIngress.validations.decide', params)
    )
    expect(decided).toMatchObject({
      outcome: 'decided',
      duplicate: false,
      dotRequestId: run.dotRequestId
    })
    expect(runtime.notifyMessageArrived).toHaveBeenCalledTimes(1)
    const replay = DotValidationDecideResultV3Schema.parse(
      await call('dotIngress.validations.decide', params)
    )
    expect(replay).toEqual({ ...decided, duplicate: true })
    expect(await code('dotIngress.validations.decide', { ...params, decision: 'reject' })).toBe(
      'dot_idempotency_conflict'
    )
    expect(
      await code('dotIngress.validations.decide', {
        ...params,
        decisionId: fixtureUuid(61),
        validationId: 'validation_unknown'
      })
    ).toBe('dot_validation_not_found')
    expect(
      await code('dotIngress.validations.decide', {
        ...params,
        decisionId: fixtureUuid(62),
        by: 'dot'
      })
    ).toBe('invalid_argument')
    expect(runtime.notifyMessageArrived).toHaveBeenCalledTimes(1)
  })
})
