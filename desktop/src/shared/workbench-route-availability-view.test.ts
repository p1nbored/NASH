import { describe, expect, it } from 'vitest'
import { ROUTING_TASK_TYPES } from './routing-table/routing-table-taxonomy'
import {
  ROUTE_UNAVAILABLE_REASONS,
  ROUTE_UNVERIFIED_REASONS,
  RouteAvailabilityViewSchema,
  RoutingTableAvailabilityViewSchema
} from './workbench-route-availability-view'

const AVAILABLE = { status: 'available', reasons: [], awaitingUserConfirmation: false } as const
const NOT_CHECKED = {
  status: 'unverified',
  reasons: ['not_checked'],
  awaitingUserConfirmation: false
} as const

describe('route availability view', () => {
  it('accepts each status with reasons of its own kind only', () => {
    expect(RouteAvailabilityViewSchema.parse(AVAILABLE)).toEqual(AVAILABLE)
    expect(RouteAvailabilityViewSchema.parse(NOT_CHECKED)).toEqual(NOT_CHECKED)
    const folder = {
      status: 'unavailable',
      reasons: ['workspace_not_git'],
      awaitingUserConfirmation: true
    }
    expect(RouteAvailabilityViewSchema.parse(folder)).toEqual(folder)
    for (const wrong of [
      { ...AVAILABLE, reasons: ['cli_missing'] },
      { status: 'unavailable', reasons: [], awaitingUserConfirmation: false },
      { status: 'unavailable', reasons: ['not_checked'], awaitingUserConfirmation: false },
      { status: 'unverified', reasons: ['quota_exhausted'], awaitingUserConfirmation: false }
    ]) {
      expect(RouteAvailabilityViewSchema.safeParse(wrong).success, JSON.stringify(wrong)).toBe(
        false
      )
    }
  })

  it('carries reason codes only: free text, extra fields and unknown codes are refused', () => {
    for (const wrong of [
      { ...NOT_CHECKED, reasons: ['spawn claude ENOENT at C:\\Users'] },
      { ...NOT_CHECKED, detail: 'claude -p printed a login prompt' },
      { ...NOT_CHECKED, reasons: ['model_listed_late'] }
    ]) {
      expect(RouteAvailabilityViewSchema.safeParse(wrong).success).toBe(false)
    }
  })

  it('refuses repeated reasons, and not_checked beside any other reason', () => {
    for (const wrong of [
      { status: 'unavailable', reasons: ['cli_missing', 'cli_missing'] },
      { status: 'unverified', reasons: ['not_checked', 'auth_unobserved'] }
    ]) {
      const view = { ...wrong, awaitingUserConfirmation: false }
      expect(RouteAvailabilityViewSchema.safeParse(view).success, JSON.stringify(view)).toBe(false)
    }
  })

  it('reports not_checked as an unverified reason, never an unavailable one', () => {
    expect(ROUTE_UNVERIFIED_REASONS).toContain('not_checked')
    expect(ROUTE_UNAVAILABLE_REASONS).not.toContain('not_checked')
  })

  it('lists the coordinator, one entry per task type and the reviewers in table order', () => {
    const view = {
      coordinator: AVAILABLE,
      routes: ROUTING_TASK_TYPES.map((taskType) => ({ taskType, availability: NOT_CHECKED })),
      reviewers: [AVAILABLE, NOT_CHECKED]
    }
    expect(RoutingTableAvailabilityViewSchema.parse(view)).toEqual(view)
    const unknownType = { ...view, routes: [{ taskType: 'gardening', availability: AVAILABLE }] }
    expect(RoutingTableAvailabilityViewSchema.safeParse(unknownType).success).toBe(false)
    expect(RoutingTableAvailabilityViewSchema.safeParse({ ...view, checkedBy: 'x' }).success).toBe(
      false
    )
  })
})
