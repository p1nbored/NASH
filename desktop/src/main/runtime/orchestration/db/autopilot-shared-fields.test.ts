import { describe, expect, it } from 'vitest'
import {
  AutopilotIdSchema as SharedIdSchema,
  AutopilotToolNameSchema as SharedToolNameSchema
} from '../../../../shared/rpc-contract/autopilot-identifier-fields'
import { AutopilotTaskSpecSchema } from '../../../../shared/rpc-contract/orchestration-autopilot-params'
import {
  PERMISSION_DECISION_DECIDERS as SharedDeciders,
  PERMISSION_DECISION_STATUSES as SharedStatuses
} from '../../../../shared/rpc-contract/permission-decision-values'
import {
  PERMISSION_DECISION_VIEW_STATUSES,
  WorkbenchPermissionDecisionViewSchema,
  WorkbenchPermissionListParams
} from '../../../../shared/rpc-contract/permission-relay-params'
import {
  PERMISSION_DECISION_DECIDERS,
  PERMISSION_DECISION_STATUSES
} from './autopilot-run-schema-definition'
import { AutopilotIdSchema, AutopilotToolNameSchema } from './autopilot-store-input'

// TypeScript review L6: the store and its wire contracts read one definition of each id rule and
// value set, so a change to one can never leave the other behind.

describe('autopilot fields shared by the store and the wire', () => {
  it('uses one definition of the permission decision values', () => {
    expect(PERMISSION_DECISION_STATUSES).toBe(SharedStatuses)
    expect(PERMISSION_DECISION_DECIDERS).toBe(SharedDeciders)
    expect(PERMISSION_DECISION_VIEW_STATUSES).toBe(SharedStatuses)
    expect(WorkbenchPermissionDecisionViewSchema.shape.decidedBy.unwrap().options).toEqual([
      ...SharedDeciders
    ])
  })

  it('uses one definition of the id and tool name rules', () => {
    expect(AutopilotIdSchema).toBe(SharedIdSchema)
    expect(AutopilotToolNameSchema).toBe(SharedToolNameSchema)
    const view = WorkbenchPermissionDecisionViewSchema.shape
    expect(view.decisionId).toBe(SharedIdSchema)
    expect(view.runId).toBe(SharedIdSchema)
    expect(view.toolName).toBe(SharedToolNameSchema)
    expect(WorkbenchPermissionListParams.shape.runId.unwrap()).toBe(SharedIdSchema)
    expect(AutopilotTaskSpecSchema.shape.parentId.unwrap()).toBe(SharedIdSchema)
  })
})
