import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DOT_DECISION_SUMMARY_MAX_CHARS,
  DOT_INGRESS_DEFAULT_RATE_PER_MINUTE,
  DOT_INGRESS_DEFAULT_RATE_PER_UTC_DAY,
  DOT_INGRESS_PROSE_MAX_CHARS
} from '../../../../shared/dot-ingress/dot-ingress-limits'
import { DotHelloResultSchema } from '../../../../shared/dot-ingress/dot-ingress-request'
import { DOT_INGRESS_METHOD_NAMES } from '../../../../shared/dot-ingress/dot-ingress-versions'
import {
  WORKBENCH_LIST_MAX_LIMIT,
  WORKBENCH_OBJECTIVE_MAX_LENGTH
} from '../../../../shared/workbench-request'
import { OrchestrationDb } from '../../orchestration/db'
import { getDotIngressSettingsStore } from '../../orchestration/db/dot-ingress-settings-store'
import { issueDotIngressCaller } from '../../dot-ingress/dot-ingress-caller'
import { issueWorkbenchDesktopCaller } from '../../workbench-caller'
import type { RpcContext, RpcRequest } from '../core'
import { RpcDispatcher } from '../dispatcher'
import { DOT_INGRESS_RPC_METHODS } from './dot-ingress'

const HELLO = 'dotIngress.hello'

function helloRequest(params: unknown = { contractVersion: 3 }): RpcRequest {
  return { id: 'req-1', authToken: '', method: HELLO, params }
}

describe('dotIngress.hello', () => {
  let owner: OrchestrationDb
  let runtime: { getRuntimeId: () => string; getOrchestrationDb: ReturnType<typeof vi.fn> }
  let dispatcher: RpcDispatcher
  beforeEach(() => {
    owner = new OrchestrationDb(':memory:')
    runtime = { getRuntimeId: () => 'runtime-fixture-1', getOrchestrationDb: vi.fn(() => owner) }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: hello reads only the members this fixture provides.
    dispatcher = new RpcDispatcher({ runtime: runtime as never, methods: DOT_INGRESS_RPC_METHODS })
  })
  afterEach(() => owner.close())

  it('registers the closed dot surface and nothing else, every method unary', () => {
    expect(DOT_INGRESS_RPC_METHODS.map((method) => method.name)).toEqual([
      'dotIngress.requests.attach',
      ...DOT_INGRESS_METHOD_NAMES
    ])
    expect(DOT_INGRESS_RPC_METHODS.some((method) => 'stream' in method)).toBe(false)
  })

  it('answers with a contract-valid result built from the user caps', async () => {
    const response = await dispatcher.dispatch(helloRequest(), {
      dotIngressCaller: issueDotIngressCaller()
    })

    expect(response.ok).toBe(true)
    if (!response.ok) {
      return
    }
    expect(DotHelloResultSchema.parse(response.result)).toEqual({
      contractVersion: 3,
      supportedContractVersions: [3],
      methods: [...DOT_INGRESS_METHOD_NAMES],
      limits: {
        maxObjectiveChars: WORKBENCH_OBJECTIVE_MAX_LENGTH,
        maxProseChars: DOT_INGRESS_PROSE_MAX_CHARS,
        listMaxLimit: WORKBENCH_LIST_MAX_LIMIT,
        maxSubmissionsPerMinute: DOT_INGRESS_DEFAULT_RATE_PER_MINUTE,
        maxSubmissionsPerUtcDay: DOT_INGRESS_DEFAULT_RATE_PER_UTC_DAY,
        maxDecisionSummaryChars: DOT_DECISION_SUMMARY_MAX_CHARS,
        maxMessageChars: 4000,
        maxValidationTitleChars: 200,
        maxValidationSummaryChars: 500
      },
      capabilities: {
        startsWithoutConfirmation: true,
        results: false,
        artifacts: false,
        validationDecisions: true
      }
    })
  })

  it('reports the caps the user changed, not the defaults', async () => {
    getDotIngressSettingsStore(owner).setRateLimits({
      ratePerMinute: 12,
      ratePerUtcDay: 200,
      timestamp: '2026-10-05T00:00:00.000Z'
    })

    const response = await dispatcher.dispatch(helloRequest(), {
      dotIngressCaller: issueDotIngressCaller()
    })

    expect(response).toMatchObject({
      ok: true,
      result: { limits: { maxSubmissionsPerMinute: 12, maxSubmissionsPerUtcDay: 200 } }
    })
  })

  it('reads the database passively and writes nothing, so a probe starts no delivery pumps', async () => {
    await dispatcher.dispatch(helloRequest(), { dotIngressCaller: issueDotIngressCaller() })

    expect(runtime.getOrchestrationDb).toHaveBeenCalledWith({ passive: true })
    expect(owner.db.prepare('SELECT count(*) AS n FROM dot_ingress_settings').get()).toEqual({
      n: 0
    })
    expect(owner.db.prepare('SELECT count(*) AS n FROM dot_ingress_events').get()).toEqual({ n: 0 })
  })

  it('never claims a connection, an approval or a result', async () => {
    const response = await dispatcher.dispatch(helloRequest(), {
      dotIngressCaller: issueDotIngressCaller()
    })

    expect(JSON.stringify(response)).not.toMatch(/connected|online|approved/i)
  })

  it('accepts the claimed client descriptor and stores nothing from it', async () => {
    const response = await dispatcher.dispatch(
      helloRequest({ contractVersion: 3, client: { name: 'dot-fixture', version: '1.2.3' } }),
      { dotIngressCaller: issueDotIngressCaller() }
    )

    expect(response.ok).toBe(true)
    expect(owner.db.prepare('SELECT count(*) AS n FROM dot_ingress_requests').get()).toEqual({
      n: 0
    })
  })

  it.each([
    ['an unknown field', { contractVersion: 3, approved: true }],
    ['a contract version that is not a number', { contractVersion: '1' }],
    ['no contract version', {}],
    ['a client name with a path', { contractVersion: 3, client: { name: 'C:\\x', version: '1' } }]
  ])('refuses %s as an invalid argument before touching the database', async (_name, params) => {
    const response = await dispatcher.dispatch(helloRequest(params), {
      dotIngressCaller: issueDotIngressCaller()
    })

    expect(response).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    expect(runtime.getOrchestrationDb).not.toHaveBeenCalled()
  })

  describe('caller checks', () => {
    const context = (overrides: Partial<RpcContext>): RpcContext => ({
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler is refused before it reads the runtime.
      runtime: runtime as never,
      ...overrides
    })
    const handler = DOT_INGRESS_RPC_METHODS[0].handler

    it('refuses a missing, forged or desktop caller with dot_ingress_forbidden', async () => {
      const issued = issueDotIngressCaller()
      const refusedContexts = [
        context({}),
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a plain copy stands in for a forged caller.
        context({ dotIngressCaller: { ...issued } as never }),
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the desktop caller stands in for a renderer masquerading as dot.
        context({ dotIngressCaller: issueWorkbenchDesktopCaller() as never }),
        context({ workbenchCaller: issueWorkbenchDesktopCaller() })
      ]

      for (const refused of refusedContexts) {
        // The handler answers in the call's contract version, so its refusal arrives as a rejection.
        await expect(
          (async () => handler({ contractVersion: 3 }, refused))()
        ).rejects.toMatchObject({
          code: 'dot_ingress_forbidden'
        })
      }
      expect(runtime.getOrchestrationDb).not.toHaveBeenCalled()
    })

    it('refuses over the dispatcher too, whichever caller field is set, with no database access', async () => {
      const desktop = issueWorkbenchDesktopCaller()
      for (const options of [{}, { workbenchCaller: desktop }]) {
        const response = await dispatcher.dispatch(helloRequest(), options)

        expect(response.ok).toBe(false)
      }
      expect(runtime.getOrchestrationDb).not.toHaveBeenCalled()
    })
  })
})
