// FIXTURE_ONLY: Routing Table views for the Settings tests, built from the shared document rows.
// Nothing here reads a store or calls a runtime; every hash is an obviously synthetic value.
import { buildTestRoutingTable } from '../../../../shared/routing-table/routing-table-document-rows.test-fixture'
import { createElement, type ReactElement } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { RoutingModelsContext } from './routing-table-model-select'

import {
  RoutingTableEditSchema,
  type RoutingTableEdit
} from '../../../../shared/routing-table/routing-table-edit-schema'
import {
  RoutingTableSchema,
  type RoutingTable
} from '../../../../shared/routing-table/routing-table-schema'
import {
  ROUTING_TASK_TYPES,
  type RoutingTaskType
} from '../../../../shared/routing-table/routing-table-taxonomy'
import {
  RoutingTableAvailabilityViewSchema,
  type RouteAvailabilityView,
  type RoutingTableAvailabilityView
} from '../../../../shared/workbench-route-availability-view'
import {
  WorkbenchRoutingTableCheckResultSchema,
  type RoutingModelLists,
  WorkbenchRoutingTableListResultSchema,
  type WorkbenchRoutingTableCheckResult,
  type WorkbenchRoutingTableListResult
} from '../../../../shared/workbench-routing-table-view'

export const FIXTURE_MODEL_LISTS: RoutingModelLists = {
  claude: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5'].map((id) => ({
    id,
    label: id,
    efforts: id.includes('haiku') ? [] : ['low', 'medium', 'high', 'xhigh', 'max']
  })),
  codex: ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-5.6-luna'].map((id) => ({
    id,
    label: id,
    efforts: [
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
      ...(id === 'gpt-5.6-luna' ? [] : ['ultra'])
    ]
  })),
  agy: [
    {
      id: 'gemini-3.8-flash-high',
      label: 'gemini-3.8-flash-high',
      efforts: ['low', 'medium', 'high']
    }
  ]
}

export function renderRouting(ui: ReactElement) {
  const wrap = (child: ReactElement) =>
    createElement(RoutingModelsContext.Provider, { value: FIXTURE_MODEL_LISTS }, child)
  const result = render(wrap(ui))
  return { ...result, rerender: (child: ReactElement) => result.rerender(wrap(child)) }
}

export function selectModel(control: HTMLElement, id: string): void {
  fireEvent.click(control)
  fireEvent.click(screen.getByRole('option', { name: id }))
}
export const FIXTURE_SHA_V1 = '1'.repeat(64)
export const FIXTURE_SHA_V2 = '2'.repeat(64)
export const FIXTURE_SHA_V3 = '3'.repeat(64)
export const FIXTURE_SHA_V4 = '4'.repeat(64)

/** Version 3: the user's table, based on version 2. */
export function fixtureTable(overrides: Record<string, unknown> = {}): RoutingTable {
  return RoutingTableSchema.parse(
    buildTestRoutingTable({
      table_version: 3,
      source: 'user',
      based_on: { table_version: 2, sha256: FIXTURE_SHA_V2 },
      created_at: '2026-10-05T08:30:00Z',
      ...overrides
    })
  )
}

export function fixtureEdit(overrides: Record<string, unknown> = {}): RoutingTableEdit {
  return RoutingTableEditSchema.parse({
    base: { table_version: 3, sha256: FIXTURE_SHA_V3 },
    changes: [
      {
        task_type: 'software_engineering',
        execution_target: 'codex_cli',
        model: 'gpt-6-astra',
        reasoning_level: 'max'
      }
    ],
    ...overrides
  })
}

export function fixtureListResult(
  overrides: Partial<WorkbenchRoutingTableListResult> = {}
): WorkbenchRoutingTableListResult {
  return WorkbenchRoutingTableListResultSchema.parse({
    active: { ok: true, version: 3, sha256: FIXTURE_SHA_V3, source: 'user', table: fixtureTable() },
    availability: null,
    models: FIXTURE_MODEL_LISTS,
    ...overrides
  })
}

const NOT_CHECKED: RouteAvailabilityView = {
  status: 'unverified',
  reasons: ['not_checked'],
  awaitingUserConfirmation: false
}
const AVAILABLE: RouteAvailabilityView = {
  status: 'available',
  reasons: [],
  awaitingUserConfirmation: false
}

/** Every route of the fixture table at one reading, with per-task-type exceptions. */
export function fixtureAvailability(
  byTaskType: Partial<Record<RoutingTaskType, RouteAvailabilityView>> = {},
  fallback: RouteAvailabilityView = NOT_CHECKED
): RoutingTableAvailabilityView {
  return RoutingTableAvailabilityViewSchema.parse({
    coordinator: fallback,
    routes: ROUTING_TASK_TYPES.map((taskType) => ({
      taskType,
      availability: byTaskType[taskType] ?? fallback
    })),
    reviewers: [fallback, fallback]
  })
}

/** A "Check now" answer for version 3: everything available except the given rows. */
export function fixtureCheckResult(
  byTaskType: Partial<Record<RoutingTaskType, RouteAvailabilityView>> = {}
): WorkbenchRoutingTableCheckResult {
  return WorkbenchRoutingTableCheckResultSchema.parse({
    ok: true,
    version: 3,
    sha256: FIXTURE_SHA_V3,
    availability: fixtureAvailability(byTaskType, AVAILABLE)
  })
}
