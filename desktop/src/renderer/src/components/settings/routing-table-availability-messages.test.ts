import { describe, expect, it } from 'vitest'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-result'
import {
  ROUTE_UNAVAILABLE_REASONS,
  ROUTE_UNVERIFIED_REASONS,
  type RouteAvailabilityView
} from '../../../../shared/workbench-route-availability-view'
import {
  routeAvailabilityLabel,
  routeCheckErrorMessage,
  routeCheckSummary,
  routeReasonText
} from './routing-table-availability-messages'
import { fixtureAvailability } from './routing-table-view.test-fixture'

const REASONS = [...ROUTE_UNAVAILABLE_REASONS, ...ROUTE_UNVERIFIED_REASONS]

function rpcError(code: string, message = 'FIXTURE_ONLY detail'): RuntimeRpcCallError {
  return new RuntimeRpcCallError({ id: 'rpc-1', ok: false, error: { code, message } })
}

describe('routeReasonText', () => {
  it('gives every reason code its own plain-English text, never the code itself', () => {
    const texts = REASONS.map(routeReasonText)
    expect(new Set(texts).size).toBe(REASONS.length)
    for (const [index, text] of texts.entries()) {
      expect(text, REASONS[index]).not.toMatch(/_/)
      expect(text.length, REASONS[index]).toBeGreaterThan(8)
    }
  })

  it('says what to do about the common failures', () => {
    expect(routeReasonText('cli_missing')).toMatch(/not installed/i)
    expect(routeReasonText('model_not_listed')).toMatch(/model/i)
    expect(routeReasonText('auth_failed')).toMatch(/sign/i)
    expect(routeReasonText('not_checked')).toMatch(/not checked/i)
  })

  it('says how a sign-in or usage-limit block lifts', () => {
    expect(routeReasonText('auth_failed')).toMatch(/then use Check routes/)
    expect(routeReasonText('quota_exhausted')).toMatch(
      /lifts when a new usage reading shows the limit reset, or use Check routes after it resets/
    )
  })
})

describe('routeAvailabilityLabel', () => {
  it('names each status, and an unchecked route as not checked rather than unverified', () => {
    const view = (value: RouteAvailabilityView): string => routeAvailabilityLabel(value).label
    expect(view({ status: 'available', reasons: [], awaitingUserConfirmation: false })).toBe(
      'Available'
    )
    expect(
      view({ status: 'unavailable', reasons: ['cli_missing'], awaitingUserConfirmation: false })
    ).toBe('Unavailable')
    expect(
      view({ status: 'unverified', reasons: ['auth_unobserved'], awaitingUserConfirmation: false })
    ).toBe('Not verified')
    expect(
      view({ status: 'unverified', reasons: ['not_checked'], awaitingUserConfirmation: false })
    ).toBe('Not checked')
  })

  it('joins the reasons and notes a default awaiting confirmation', () => {
    const label = routeAvailabilityLabel({
      status: 'unavailable',
      reasons: ['workspace_not_git', 'quota_exhausted'],
      awaitingUserConfirmation: true
    })
    expect(label.detail).toContain(routeReasonText('workspace_not_git'))
    expect(label.detail).toContain(routeReasonText('quota_exhausted'))
    expect(label.detail).toMatch(/awaiting your confirmation/i)
    expect(
      routeAvailabilityLabel({ status: 'available', reasons: [], awaitingUserConfirmation: false })
        .detail
    ).toBe('')
  })
})

describe('routeCheckSummary', () => {
  it('counts every checked entry by status', () => {
    const summary = routeCheckSummary(
      fixtureAvailability(
        {
          software_engineering: {
            status: 'unavailable',
            reasons: ['model_not_listed'],
            awaitingUserConfirmation: false
          },
          routine_analysis_batch: {
            status: 'unverified',
            reasons: ['model_list_unavailable'],
            awaitingUserConfirmation: false
          }
        },
        { status: 'available', reasons: [], awaitingUserConfirmation: false }
      )
    )
    expect(summary).toBe('Routes checked: 11 available, 1 unavailable, 1 not verified.')
  })
})

describe('routeCheckErrorMessage', () => {
  it('explains checks that are not installed, and never repeats raw error text', () => {
    const missing = routeCheckErrorMessage(rpcError('workbench_route_availability_unavailable'))
    expect(missing).toMatch(/not available/i)
    expect(missing).not.toContain('FIXTURE_ONLY')
    expect(routeCheckErrorMessage(rpcError('runtime_error', 'secret-ish'))).not.toContain(
      'secret-ish'
    )
    expect(routeCheckErrorMessage(rpcError('workbench_forbidden'))).toMatch(/desktop/i)
  })
})
