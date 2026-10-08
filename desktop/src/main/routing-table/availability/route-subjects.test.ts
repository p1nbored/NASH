import { describe, expect, it } from 'vitest'
import {
  RouteSchema,
  type Coordinator,
  type ValidationReviewer
} from '../../../shared/routing-table/routing-table-schema'
import { subjectForCoordinator, subjectForReviewer, subjectForRoute } from './route-subjects'

const COORDINATOR: Coordinator = {
  agent: 'claude',
  model: 'claude-opus-5-5',
  reasoning_level: 'max'
}

function route(fields: Record<string, unknown>) {
  return RouteSchema.parse({ task_type: 'software_engineering', ...fields })
}

describe('subjectForRoute', () => {
  it('resolves an inherit/inherit primary row to the coordinator configuration, and records that', () => {
    const row = route({
      task_type: 'coordinator_reasoning',
      execution_target: 'claude_primary',
      model: 'inherit',
      reasoning_level: 'inherit'
    })
    expect(subjectForRoute(row, COORDINATOR)).toEqual({
      target: 'claude_primary',
      primaryAgent: 'claude',
      model: 'claude-opus-5-5',
      reasoningLevel: 'max',
      requirement: 'required',
      inheritsCoordinator: true
    })
  })

  it('does the same for a workflow row', () => {
    const row = route({
      task_type: 'configured_project_workflow',
      execution_target: 'claude_workflow',
      model: 'inherit',
      reasoning_level: 'inherit'
    })
    expect(subjectForRoute(row, COORDINATOR)).toMatchObject({
      target: 'claude_workflow',
      primaryAgent: 'claude',
      model: 'claude-opus-5-5',
      reasoningLevel: 'max',
      inheritsCoordinator: true
    })
  })

  it('keeps a concrete row as written', () => {
    const row = route({
      execution_target: 'claude_subagent',
      model: 'claude-sonnet-5-5',
      reasoning_level: 'high'
    })
    expect(subjectForRoute(row, COORDINATOR)).toEqual({
      target: 'claude_subagent',
      primaryAgent: 'claude',
      model: 'claude-sonnet-5-5',
      reasoningLevel: 'high',
      requirement: 'required',
      inheritsCoordinator: false
    })
  })

  it('takes only the inherited field from the coordinator when a workflow row names the other', () => {
    const row = route({
      task_type: 'configured_project_workflow',
      execution_target: 'claude_workflow',
      model: 'claude-sonnet-5-5',
      reasoning_level: 'inherit'
    })
    expect(subjectForRoute(row, COORDINATOR)).toMatchObject({
      model: 'claude-sonnet-5-5',
      reasoningLevel: 'max',
      inheritsCoordinator: false
    })
  })

  it('carries an if_supported requirement', () => {
    const row = route({
      task_type: 'fast_writing_or_alternative_draft',
      execution_target: 'agy_cli',
      model: 'gemini-3.8-flash-high',
      reasoning_level: 'high',
      reasoning_requirement: 'if_supported'
    })
    expect(subjectForRoute(row, COORDINATOR)).toMatchObject({
      target: 'agy_cli',
      requirement: 'if_supported'
    })
  })
})

describe('subjectForCoordinator and subjectForReviewer', () => {
  it('checks the coordinator as the primary session with its own concrete values', () => {
    expect(subjectForCoordinator(COORDINATOR)).toEqual({
      target: 'claude_primary',
      primaryAgent: 'claude',
      model: 'claude-opus-5-5',
      reasoningLevel: 'max',
      requirement: 'required',
      inheritsCoordinator: false
    })
  })

  it.each([
    ['codex_cli', 'gpt-6.1-sol'],
    ['claude_headless', 'claude-opus-5-5']
  ] as const)('maps a %s reviewer to a required route of that target', (target, model) => {
    const reviewer: ValidationReviewer = { target, model, reasoning_level: 'high' }
    expect(subjectForReviewer(reviewer)).toEqual({
      target,
      model,
      reasoningLevel: 'high',
      requirement: 'required',
      inheritsCoordinator: false
    })
  })
})

it('keeps legacy target ids while pinning Codex for primary and inherited workflow routes', () => {
  const coordinator = {
    agent: 'codex' as const,
    model: 'gpt-6.1-sol',
    reasoning_level: 'max' as const
  }
  expect(subjectForCoordinator(coordinator)).toMatchObject({
    target: 'claude_primary',
    primaryAgent: 'codex',
    model: 'gpt-6.1-sol'
  })
  const workflow = route({
    task_type: 'configured_project_workflow',
    execution_target: 'claude_workflow',
    model: 'inherit',
    reasoning_level: 'inherit'
  })
  expect(subjectForRoute(workflow, coordinator)).toMatchObject({
    target: 'claude_workflow',
    primaryAgent: 'codex',
    model: 'gpt-6.1-sol',
    inheritsCoordinator: true
  })
})

it('does not change independent CLI route identity when the primary CLI changes', () => {
  const row = route({
    execution_target: 'codex_cli',
    model: 'gpt-6.1-sol',
    reasoning_level: 'high'
  })
  expect(
    subjectForRoute(row, { agent: 'codex', model: 'gpt-6.1-sol', reasoning_level: 'max' })
  ).toEqual(subjectForRoute(row, COORDINATOR))
})
