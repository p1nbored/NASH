import { describe, expect, it } from 'vitest'
import { isEnglishText } from '../../../shared/english-text'
import {
  buildPrimarySessionAgents,
  SUBAGENT_NAME_PREFIX,
  subagentNameForTaskType
} from './primary-session-agents'
import { findForbiddenPermissionText } from './primary-session-permission'
import type { SubagentRouteRowInput } from './primary-session-types'

// FIXTURE_ONLY: the document routes of architecture-direction.md section 5, in the shape this
// package takes. The wiring step maps the Routing Table rows onto this shape.
const DOCUMENT_ROWS: readonly SubagentRouteRowInput[] = [
  row('coordinator_reasoning', 'claude_primary', 'inherit', 'inherit'),
  row('complex_planning_reasoning', 'claude_subagent', 'claude-opus-5-5', 'max'),
  row('software_engineering', 'claude_subagent', 'claude-sonnet-5-5', 'max'),
  row('scientific_experiment_validation', 'codex_cli', 'gpt-6-astra', 'max'),
  row('complex_pdf_evidence_analysis', 'codex_cli', 'gpt-6.1-sol', 'max'),
  row('general_research_analysis', 'codex_cli', 'gpt-6.1-sol', 'max'),
  row('routine_analysis_batch', 'codex_cli', 'gpt-6.1-sol', 'high'),
  row('high_quality_writing', 'claude_subagent', 'claude-opus-5-5', 'high'),
  row('fast_writing_or_alternative_draft', 'agy_cli', 'gemini-3.8-flash-high', 'high'),
  row('configured_project_workflow', 'claude_workflow', 'inherit', 'inherit')
]

function row(
  taskType: string,
  executionTarget: string,
  model: string,
  effort: string
): SubagentRouteRowInput {
  return { taskType, executionTarget, model, effort }
}

type DefinitionShape = {
  readonly description: string
  readonly prompt: string
  readonly model: string
  readonly effort: string
}

function parseDefinitions(json: string | null): Record<string, DefinitionShape> {
  const parsed: Record<string, DefinitionShape> = JSON.parse(json ?? '{}')
  return parsed
}

function agentsFor(rows: readonly SubagentRouteRowInput[]) {
  const result = buildPrimarySessionAgents(rows)
  if (!result.ok) {
    throw new Error(`expected agents, got ${result.refusal.code}`)
  }
  return result.value
}

describe('subagentNameForTaskType', () => {
  it('prefixes the task type with autopilot-', () => {
    expect(SUBAGENT_NAME_PREFIX).toBe('autopilot-')
    expect(subagentNameForTaskType('software_engineering')).toBe('autopilot-software_engineering')
  })
})

describe('buildPrimarySessionAgents', () => {
  it('defines one autopilot-<task_type> agent per claude_subagent row and nothing else', () => {
    const agents = agentsFor(DOCUMENT_ROWS)
    expect(agents.names).toEqual([
      'autopilot-complex_planning_reasoning',
      'autopilot-software_engineering',
      'autopilot-high_quality_writing'
    ])
    expect(Object.keys(parseDefinitions(agents.json))).toEqual(agents.names)
  })

  it('gives each definition the row model and effort, a description and a prompt', () => {
    const agents = agentsFor(DOCUMENT_ROWS)
    const definitions = parseDefinitions(agents.json)
    expect(definitions['autopilot-software_engineering']).toMatchObject({
      model: 'claude-sonnet-5-5',
      effort: 'max'
    })
    expect(definitions['autopilot-complex_planning_reasoning']).toMatchObject({
      model: 'claude-opus-5-5',
      effort: 'max'
    })
    expect(definitions['autopilot-high_quality_writing']).toMatchObject({
      model: 'claude-opus-5-5',
      effort: 'high'
    })
    for (const definition of Object.values(definitions)) {
      expect(Object.keys(definition).sort()).toEqual(['description', 'effort', 'model', 'prompt'])
      expect(String(definition.description).length).toBeGreaterThan(20)
      expect(String(definition.prompt).length).toBeGreaterThan(40)
    }
  })

  it('leaves codex, agy, workflow and primary rows out of the definitions', () => {
    const json = agentsFor(DOCUMENT_ROWS).json ?? ''
    for (const excluded of [
      'coordinator_reasoning',
      'scientific_experiment_validation',
      'complex_pdf_evidence_analysis',
      'general_research_analysis',
      'routine_analysis_batch',
      'fast_writing_or_alternative_draft',
      'configured_project_workflow',
      'gpt-6',
      'gemini'
    ]) {
      expect(json).not.toContain(excluded)
    }
  })

  it('returns no JSON and no names when the table has no claude_subagent row', () => {
    const agents = agentsFor(DOCUMENT_ROWS.filter((r) => r.executionTarget !== 'claude_subagent'))
    expect(agents).toEqual({ names: [], json: null })
    expect(agentsFor([])).toEqual({ names: [], json: null })
  })

  it('keeps the input order, which is the taxonomy order', () => {
    const reversed = DOCUMENT_ROWS.toReversed()
    expect(agentsFor(reversed).names).toEqual([
      'autopilot-high_quality_writing',
      'autopilot-software_engineering',
      'autopilot-complex_planning_reasoning'
    ])
  })

  it('accepts every Claude effort level, ultra, none and minimal included (D-027)', () => {
    for (const effort of ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']) {
      const agents = agentsFor([
        row('software_engineering', 'claude_subagent', 'claude-sonnet-5-5', effort)
      ])
      expect(parseDefinitions(agents.json)['autopilot-software_engineering'].effort).toBe(effort)
    }
  })

  it('writes English framework text for every definition', () => {
    const definitions = parseDefinitions(agentsFor(DOCUMENT_ROWS).json)
    for (const definition of Object.values(definitions)) {
      expect(isEnglishText(definition.description)).toBe(true)
      expect(isEnglishText(definition.prompt)).toBe(true)
    }
  })

  it('keeps the JSON free of characters that break shell quoting and of any permission override', () => {
    const json = agentsFor(DOCUMENT_ROWS).json ?? ''
    expect(json).not.toMatch(/['`\\]/)
    expect(json).not.toContain('permissionMode')
    expect(json).not.toContain('"tools"')
    expect(json).not.toContain('"hooks"')
    expect(json).not.toContain('"mcpServers"')
    expect(findForbiddenPermissionText(`claude --permission-mode manual ${json}`)).toBeNull()
  })

  it('tells the subagent to keep the attempt id, work only on its request and not run task commands', () => {
    const definitions = parseDefinitions(agentsFor(DOCUMENT_ROWS).json)
    const prompt = definitions['autopilot-software_engineering'].prompt
    expect(prompt).toContain('attempt id')
    expect(prompt).toContain('software_engineering')
    expect(prompt).toContain('in English')
    expect(prompt).toMatch(/do not (run|start)/i)
  })

  it('does not mutate frozen input rows', () => {
    const frozen = DOCUMENT_ROWS.map((r) => Object.freeze({ ...r }))
    expect(() => buildPrimarySessionAgents(Object.freeze(frozen))).not.toThrow()
  })

  it.each([
    [
      'inherit as a subagent model',
      row('software_engineering', 'claude_subagent', 'inherit', 'max')
    ],
    ['an alias model', row('software_engineering', 'claude_subagent', 'sonnet', 'max')],
    ['a latest model', row('software_engineering', 'claude_subagent', 'latest', 'max')],
    ['a non-Claude model', row('software_engineering', 'claude_subagent', 'gpt-6-astra', 'max')],
    [
      'an inherit effort',
      row('software_engineering', 'claude_subagent', 'claude-sonnet-5-5', 'inherit')
    ],
    [
      'an unknown effort',
      row('software_engineering', 'claude_subagent', 'claude-sonnet-5-5', 'extreme')
    ],
    ['an empty effort', row('software_engineering', 'claude_subagent', 'claude-sonnet-5-5', '')]
  ])('refuses %s', (_label, bad) => {
    const result = buildPrimarySessionAgents([bad])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.refusal.code).toBe('autopilot_session_agents_invalid')
    }
  })

  it.each([
    ['uppercase', 'Software_Engineering'],
    ['a colon', 'software:engineering'],
    ['a leading dash', '-software'],
    ['a space', 'software engineering'],
    ['an empty string', ''],
    ['a quote', "software'engineering"],
    ['a leading digit', '1software'],
    ['an over-long type', `a${'b'.repeat(64)}`]
  ])('refuses a task type with %s', (_label, taskType) => {
    const result = buildPrimarySessionAgents([
      row(taskType, 'claude_subagent', 'claude-sonnet-5-5', 'max')
    ])
    expect(result.ok).toBe(false)
  })

  it('refuses an unknown execution target instead of skipping it', () => {
    const result = buildPrimarySessionAgents([
      row('software_engineering', 'claude_agent', 'claude-sonnet-5-5', 'max')
    ])
    expect(result.ok).toBe(false)
  })

  it('refuses two claude_subagent rows for the same task type', () => {
    const result = buildPrimarySessionAgents([
      row('software_engineering', 'claude_subagent', 'claude-sonnet-5-5', 'max'),
      row('software_engineering', 'claude_subagent', 'claude-opus-5-5', 'high')
    ])
    expect(result.ok).toBe(false)
  })

  it('refuses a duplicate task type even when the other row has another target', () => {
    const result = buildPrimarySessionAgents([
      row('software_engineering', 'claude_subagent', 'claude-sonnet-5-5', 'max'),
      row('software_engineering', 'codex_cli', 'gpt-6.1-sol', 'high')
    ])
    expect(result.ok).toBe(false)
  })

  it('refuses more than ten definitions', () => {
    const many = Array.from({ length: 11 }, (_unused, index) =>
      row(`type_${index}`, 'claude_subagent', 'claude-sonnet-5-5', 'high')
    )
    const result = buildPrimarySessionAgents(many)
    expect(result.ok).toBe(false)
    expect(buildPrimarySessionAgents(many.slice(0, 10)).ok).toBe(true)
  })

  it('keeps the compact JSON under the command line budget for the full default table', () => {
    expect((agentsFor(DOCUMENT_ROWS).json ?? '').length).toBeLessThan(4_000)
  })
})
