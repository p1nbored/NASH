import { describe, expect, it } from 'vitest'
import {
  WORKBENCH_DOT_INGRESS_FAILURES,
  WorkbenchDotIngressEnableWorkspaceParams,
  WorkbenchDotIngressRequestsListParams,
  WorkbenchDotIngressRequestsListResultSchema,
  WorkbenchDotIngressSetEnabledParams,
  WorkbenchDotIngressSetRateLimitsParams,
  WorkbenchDotIngressSettingsResultSchema
} from './workbench-dot-ingress-params'

const WORKSPACE_REF = `dws_${'a'.repeat(24)}`

describe('desktop dot interface params and views', () => {
  it('enables a workspace with a read-only ceiling unless the user raises it', () => {
    const base = { workspaceId: 'fixture-repo::/fixture/repo', label: 'fixture-repo' }
    expect(WorkbenchDotIngressEnableWorkspaceParams.parse(base).maxAccess).toBe('read_only')
    expect(
      WorkbenchDotIngressEnableWorkspaceParams.parse({ ...base, maxAccess: 'workspace_write' })
        .maxAccess
    ).toBe('workspace_write')
    expect(
      WorkbenchDotIngressEnableWorkspaceParams.safeParse({ ...base, maxAccess: 'admin' }).success
    ).toBe(false)
    expect(
      WorkbenchDotIngressEnableWorkspaceParams.safeParse({ ...base, workspaceBinding: 'x' }).success
    ).toBe(false)
  })

  it('takes only the switch, the caps and a page as other inputs', () => {
    expect(WorkbenchDotIngressSetEnabledParams.safeParse({ enabled: true }).success).toBe(true)
    expect(
      WorkbenchDotIngressSetEnabledParams.safeParse({ enabled: true, token: 'x' }).success
    ).toBe(false)
    expect(
      WorkbenchDotIngressSetRateLimitsParams.safeParse({ ratePerMinute: 61, ratePerUtcDay: 1 })
        .success
    ).toBe(false)
    expect(WorkbenchDotIngressRequestsListParams.parse({})).toEqual({ limit: 50 })
  })

  it('never claims a connection and carries no token or endpoint in the settings view', () => {
    const view = {
      enabled: true,
      connection: 'not_connected',
      listening: true,
      failure: null,
      rateLimits: { ratePerMinute: 6, ratePerUtcDay: 100 },
      updatedAt: null,
      workspaces: [
        {
          workspaceRef: WORKSPACE_REF,
          workspaceId: 'fixture-repo::/fixture/repo',
          label: 'fixture-repo',
          enabled: true,
          maxAccess: 'read_only'
        }
      ]
    }
    expect(WorkbenchDotIngressSettingsResultSchema.parse(view)).toEqual(view)
    for (const field of ['ingressToken', 'endpoint', 'connected']) {
      expect(
        WorkbenchDotIngressSettingsResultSchema.safeParse({ ...view, [field]: 'x' }).success,
        field
      ).toBe(false)
    }
    expect(
      WorkbenchDotIngressSettingsResultSchema.safeParse({ ...view, connection: 'connected' })
        .success
    ).toBe(false)
    expect([...WORKBENCH_DOT_INGRESS_FAILURES]).toEqual([
      'listen_failed',
      'metadata_invalid',
      'metadata_write_failed',
      'metadata_not_secured'
    ])
  })

  it('shows the desktop what dot submitted, with the claimed client marked as a claim', () => {
    const view = {
      requests: [
        {
          dotRequestId: '00000000-0000-4000-8000-000000000001',
          sequence: 1,
          state: 'submitted',
          workspaceRef: WORKSPACE_REF,
          workspaceId: 'fixture-repo::/fixture/repo',
          objective: 'Summarize the open issues.',
          requestedAccess: 'read_only',
          deliverableLanguage: null,
          claimedClient: { name: 'dot', version: '1.0.0' },
          failureCode: null,
          createdAt: '2026-10-05T00:00:10.000Z',
          updatedAt: '2026-10-05T00:00:10.000Z',
          run: { state: 'active', blocker: null }
        }
      ],
      nextBeforeSequence: null
    }
    expect(WorkbenchDotIngressRequestsListResultSchema.parse(view)).toEqual(view)
  })
})
