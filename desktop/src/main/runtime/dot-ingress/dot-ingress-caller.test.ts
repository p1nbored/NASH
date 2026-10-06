import { describe, expect, it } from 'vitest'
import {
  DOT_INGRESS_PRINCIPAL_ID,
  DOT_INGRESS_SOURCE
} from '../../../shared/dot-ingress/dot-ingress-limits'
import {
  DOT_INGRESS_ERROR_MESSAGES,
  isDotIngressErrorCode
} from '../../../shared/dot-ingress/dot-ingress-errors'
import { issueWorkbenchDesktopCaller, requireWorkbenchCaller } from '../workbench-caller'
import { OrchestrationError } from '../orchestration/orchestration-error'
import { issueDotIngressCaller, requireDotIngressCaller } from './dot-ingress-caller'
import { thrownCodeOf } from './dot-ingress-transport.test-fixture'

describe('dot ingress caller brand', () => {
  it('issues a frozen caller whose principal and source are the contract constants', () => {
    const caller = issueDotIngressCaller()

    expect(Object.isFrozen(caller)).toBe(true)
    expect(caller).toEqual({ principalId: DOT_INGRESS_PRINCIPAL_ID, source: DOT_INGRESS_SOURCE })
    expect(requireDotIngressCaller(caller)).toBe(caller)
  })

  it('accepts every issued caller and never shares one object between issues', () => {
    const first = issueDotIngressCaller()
    const second = issueDotIngressCaller()

    expect(second).not.toBe(first)
    expect(requireDotIngressCaller(first)).toBe(first)
    expect(requireDotIngressCaller(second)).toBe(second)
  })

  it('refuses a missing caller', () => {
    expect(thrownCodeOf(() => requireDotIngressCaller(undefined))).toBe('dot_ingress_forbidden')
  })

  it('refuses forged, copied and JSON-smuggled callers', () => {
    const issued = issueDotIngressCaller()
    const impostors = [
      { principalId: issued.principalId, source: issued.source },
      Object.freeze({ ...issued }),
      Object.create(issued),
      JSON.parse(JSON.stringify(issued))
    ]

    for (const impostor of impostors) {
      expect(thrownCodeOf(() => requireDotIngressCaller(impostor))).toBe('dot_ingress_forbidden')
    }
  })

  it('refuses the desktop caller, and the desktop gate refuses the dot caller', () => {
    const desktop = issueWorkbenchDesktopCaller()
    const dot = issueDotIngressCaller()

    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the cast stands in for a hostile caller that ignores the type.
    expect(thrownCodeOf(() => requireDotIngressCaller(desktop as never))).toBe(
      'dot_ingress_forbidden'
    )
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the cast stands in for a hostile caller that ignores the type.
    expect(thrownCodeOf(() => requireWorkbenchCaller(dot as never))).toBe('workbench_forbidden')
    expect(dot.principalId).not.toBe(desktop.principalId)
    expect(dot.source).not.toBe(desktop.source)
  })

  it('refuses with the contract code and its fixed English message, as an OrchestrationError', () => {
    expect(isDotIngressErrorCode('dot_ingress_forbidden')).toBe(true)
    try {
      requireDotIngressCaller(undefined)
      expect.unreachable('a missing caller must be refused')
    } catch (error) {
      expect(error).toBeInstanceOf(OrchestrationError)
      expect(error).toMatchObject({
        code: 'dot_ingress_forbidden',
        message: DOT_INGRESS_ERROR_MESSAGES.dot_ingress_forbidden
      })
    }
  })
})
