import { describe, expect, it } from 'vitest'
import { WORKFLOW_RUN_STATUSES } from './autopilot-run-schema-definition'
import {
  WORKFLOW_RUN_TERMINAL_STATUSES,
  WORKFLOW_RUN_TRANSITIONS,
  isWorkflowRunTransitionAllowed
} from './workflow-run-transition'

// Frozen on purpose: a new edge is a design change, so it must show up as a diff in this list.
const EXPECTED_EDGES = [
  ['launching', 'active'],
  ['launching', 'failed'],
  ['launching', 'canceled'],
  ['launching', 'unverifiable'],
  ['active', 'completing'],
  ['active', 'failed'],
  ['active', 'canceled'],
  ['active', 'unverifiable'],
  ['completing', 'completed'],
  ['completing', 'active'],
  ['completing', 'failed'],
  ['completing', 'canceled'],
  ['completing', 'unverifiable'],
  ['unverifiable', 'active'],
  ['unverifiable', 'failed'],
  ['unverifiable', 'canceled']
] as const

describe('workflow run status edges', () => {
  it('has exactly the frozen edge list', () => {
    const actual = WORKFLOW_RUN_STATUSES.flatMap((from) =>
      WORKFLOW_RUN_TRANSITIONS[from].map((to) => [from, to])
    )
    expect(actual).toEqual(EXPECTED_EDGES.map((edge) => [...edge]))
  })

  it('is deeply frozen so no caller can add an edge at run time', () => {
    expect(Object.isFrozen(WORKFLOW_RUN_TRANSITIONS)).toBe(true)
    for (const status of WORKFLOW_RUN_STATUSES) {
      expect(Object.isFrozen(WORKFLOW_RUN_TRANSITIONS[status])).toBe(true)
    }
    expect(Object.isFrozen(WORKFLOW_RUN_TERMINAL_STATUSES)).toBe(true)
  })

  it('allows every listed edge and refuses every other pair, including self-edges', () => {
    const allowed = new Set(EXPECTED_EDGES.map(([from, to]) => `${from}>${to}`))
    for (const from of WORKFLOW_RUN_STATUSES) {
      for (const to of WORKFLOW_RUN_STATUSES) {
        expect(isWorkflowRunTransitionAllowed(from, to), `${from} to ${to}`).toBe(
          allowed.has(`${from}>${to}`)
        )
      }
    }
  })

  it('gives completed, failed and canceled no way out', () => {
    expect([...WORKFLOW_RUN_TERMINAL_STATUSES]).toEqual(['completed', 'failed', 'canceled'])
    for (const status of WORKFLOW_RUN_TERMINAL_STATUSES) {
      expect(WORKFLOW_RUN_TRANSITIONS[status]).toEqual([])
    }
  })

  it('never reaches completed except through completing, so the primary must declare completion', () => {
    const into = WORKFLOW_RUN_STATUSES.filter((from) =>
      isWorkflowRunTransitionAllowed(from, 'completed')
    )
    expect(into).toEqual(['completing'])
  })

  it('never relaunches: nothing leads back to launching', () => {
    for (const from of WORKFLOW_RUN_STATUSES) {
      expect(isWorkflowRunTransitionAllowed(from, 'launching')).toBe(false)
    }
  })
})
