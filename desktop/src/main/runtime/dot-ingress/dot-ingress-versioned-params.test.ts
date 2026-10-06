import { describe, expect, it } from 'vitest'
import { DOT_INGRESS_ERROR_MESSAGES } from '../../../shared/dot-ingress/dot-ingress-errors'
import {
  DOT_INGRESS_V2_ONLY_ERROR_MESSAGES,
  type DotIngressV2OnlyErrorCode
} from '../../../shared/dot-ingress/dot-ingress-errors-v2'
import { OrchestrationError } from '../orchestration/orchestration-error'
import { dotRefusal } from './dot-ingress-refusals'
import { answerInVersion } from './dot-ingress-versioned-params'

async function rejectionOf(operation: () => Promise<unknown>): Promise<unknown> {
  try {
    await operation()
    return null
  } catch (error) {
    return error
  }
}

describe('dot errors by contract version', () => {
  it.each([
    [
      'dot_access_above_maximum',
      'dot_workspace_unknown',
      { reason: 'access_above_workspace_maximum', maxAccess: 'read_only' }
    ],
    ['dot_decision_deny_only', 'dot_decision_desktop_only', { reason: 'run_read_only' }],
    ['dot_request_busy', 'dot_request_not_cancelable', { reason: 'run_stop_unconfirmed' }]
  ] as const)(
    'gives a version 1 call %s as %s, with the same data and the version 1 message',
    async (code: DotIngressV2OnlyErrorCode, fallback, data) => {
      const thrown = dotRefusal(code, data)
      expect(thrown.message).toBe(DOT_INGRESS_V2_ONLY_ERROR_MESSAGES[code])
      const fail = (): never => {
        throw thrown
      }

      const v1 = await rejectionOf(() => answerInVersion({ contractVersion: 1 }, fail))
      const v2 = await rejectionOf(() => answerInVersion({ contractVersion: 2 }, fail))

      expect(v1).toBeInstanceOf(OrchestrationError)
      expect(v1).toMatchObject({
        code: fallback,
        message: DOT_INGRESS_ERROR_MESSAGES[fallback],
        data
      })
      expect(v2).toBe(thrown)
    }
  )

  it('passes version 1 codes and foreign errors through unchanged in both versions', async () => {
    const known = dotRefusal('dot_request_not_found')
    const foreign = new Error('fixture failure')
    for (const contractVersion of [1, 2]) {
      for (const thrown of [known, foreign]) {
        const fail = async (): Promise<never> => {
          throw thrown
        }
        expect(await rejectionOf(() => answerInVersion({ contractVersion }, fail))).toBe(thrown)
      }
    }
  })

  it('returns what a sync or an async call returns', async () => {
    expect(await answerInVersion({ contractVersion: 1 }, () => 'sync')).toBe('sync')
    expect(await answerInVersion({ contractVersion: 2 }, async () => 'async')).toBe('async')
  })
})
