import { describe, expect, it } from 'vitest'
import {
  WORKBENCH_REQUEST_STATUSES,
  WorkbenchRequestSchema
} from '../../../../shared/workbench-request'
import { WORKBENCH_STORED_STATUSES } from './workbench-request-schema-definition'
import { WORKBENCH_VIEW_STATUS, projectWorkbenchRequest } from './workbench-request-projection'

const row = (status: string, overrides: Record<string, unknown> = {}) => ({
  sequence: 3,
  request_id: 'fixture-request',
  workspace_id: 'folder:fixture',
  objective: 'Fixture objective.',
  status,
  revision: 2,
  created_at: '2026-10-05T12:00:00.000Z',
  updated_at: '2026-10-05T12:01:00.000Z',
  blocker_reason: status === 'LAUNCH_BLOCKED' ? 'launch_blocked' : null,
  blocker_detail: status === 'LAUNCH_BLOCKED' ? 'launch_unverifiable' : null,
  workflow_run_id: status === 'LAUNCHED' ? 'run_fixture_1' : null,
  ...overrides
})

describe('Workbench view projection (D-016 section 1.2)', () => {
  it('maps every stored status onto exactly one of the four view statuses', () => {
    expect(Object.keys(WORKBENCH_VIEW_STATUS).sort()).toEqual([...WORKBENCH_STORED_STATUSES].sort())
    expect(WORKBENCH_VIEW_STATUS).toEqual({
      RECEIVED: 'ROUTING',
      LAUNCHING: 'ROUTING',
      LAUNCHED: 'ROUTED',
      LAUNCH_BLOCKED: 'ROUTING_BLOCKED',
      CANCELED: 'CANCELED'
    })
    expect(new Set(Object.values(WORKBENCH_VIEW_STATUS))).toEqual(
      new Set(WORKBENCH_REQUEST_STATUSES)
    )
    expect(Object.isFrozen(WORKBENCH_VIEW_STATUS)).toBe(true)
  })

  it.each(WORKBENCH_STORED_STATUSES)('projects a stored %s row into a parseable view', (status) => {
    const view = projectWorkbenchRequest(row(status))
    expect(WorkbenchRequestSchema.parse(view)).toEqual(view)
    expect(view).toMatchObject({
      status: WORKBENCH_VIEW_STATUS[status],
      taskId: null,
      modelProfileId: null,
      executionSurface: null,
      pluginOperationId: null,
      clefDecisionId: null
    })
  })

  it('carries the launch blocker and the run link the row holds', () => {
    expect(projectWorkbenchRequest(row('LAUNCH_BLOCKED'))).toMatchObject({
      routingBlocker: { reason: 'launch_blocked', detail: 'launch_unverifiable' },
      workflowRunId: null
    })
    expect(projectWorkbenchRequest(row('LAUNCHED'))).toMatchObject({
      routingBlocker: null,
      workflowRunId: 'run_fixture_1'
    })
  })

  it.each(['ROUTING', 'ROUTED', 'ROUTING_BLOCKED', 'QUEUED', null])(
    'fails closed on a stored status outside v3: %s',
    (status) => {
      expect(() => projectWorkbenchRequest(row(String(status)))).toThrow(
        expect.objectContaining({ code: 'workbench_recovery_required' })
      )
    }
  )

  it('fails closed on a blocker that disagrees with the stored status', () => {
    expect(() =>
      projectWorkbenchRequest(
        row('RECEIVED', { blocker_reason: 'launch_blocked', blocker_detail: 'launch_refused' })
      )
    ).toThrow()
    expect(() =>
      projectWorkbenchRequest(row('LAUNCH_BLOCKED', { blocker_detail: 'free text' }))
    ).toThrow()
  })
})
