import { describe, expect, it } from 'vitest'
import {
  CLASSIFIER_ONLY_TASK_TYPES,
  CLAUDE_SESSION_FLAG_LEVELS,
  CONCRETE_REASONING_LEVELS,
  COORDINATOR_TASK_TYPE,
  EXECUTION_TARGETS,
  INHERITING_TARGETS,
  REASONING_LEVELS,
  REASONING_REQUIREMENTS,
  ROUTING_TAXONOMY_VERSION,
  ROUTING_TASK_TYPES,
  VALIDATION_REVIEWER_TARGETS
} from './routing-table-taxonomy'

describe('routing table taxonomy (taxonomy_version 2)', () => {
  it('lists the ten task types in the order the classifier question set uses', () => {
    expect(ROUTING_TAXONOMY_VERSION).toBe(2)
    expect([...ROUTING_TASK_TYPES]).toEqual([
      'coordinator_reasoning',
      'complex_planning_reasoning',
      'software_engineering',
      'scientific_experiment_validation',
      'complex_pdf_evidence_analysis',
      'general_research_analysis',
      'routine_analysis_batch',
      'high_quality_writing',
      'fast_writing_or_alternative_draft',
      'configured_project_workflow'
    ])
    expect(COORDINATOR_TASK_TYPE).toBe('coordinator_reasoning')
  })

  it('keeps the classifier escape out of the routable task types', () => {
    expect([...CLASSIFIER_ONLY_TASK_TYPES]).toEqual(['needs_clarification'])
    const routable: readonly string[] = ROUTING_TASK_TYPES
    for (const type of CLASSIFIER_ONLY_TASK_TYPES) {
      expect(routable.includes(type)).toBe(false)
    }
  })

  it('has exactly the five execution targets of the architecture document', () => {
    expect([...EXECUTION_TARGETS]).toEqual([
      'claude_primary',
      'claude_subagent',
      'claude_workflow',
      'codex_cli',
      'agy_cli'
    ])
    expect([...INHERITING_TARGETS]).toEqual(['claude_primary', 'claude_workflow'])
  })

  it('allows ultra, none and minimal, in order of depth; the CLI listing decides (D-027)', () => {
    expect([...CONCRETE_REASONING_LEVELS]).toEqual([
      'none',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
      'ultra'
    ])
    expect([...REASONING_LEVELS]).toEqual([...CONCRETE_REASONING_LEVELS, 'inherit'])
    expect([...REASONING_REQUIREMENTS]).toEqual(['required', 'if_supported'])
  })

  it('knows the levels a Claude session flag can carry today, all of them policy levels', () => {
    expect([...CLAUDE_SESSION_FLAG_LEVELS]).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    for (const level of CLAUDE_SESSION_FLAG_LEVELS) {
      expect(CONCRETE_REASONING_LEVELS).toContain(level)
    }
  })

  it('limits validation reviewers to the two headless review targets', () => {
    expect([...VALIDATION_REVIEWER_TARGETS]).toEqual(['codex_cli', 'claude_headless'])
  })
})
