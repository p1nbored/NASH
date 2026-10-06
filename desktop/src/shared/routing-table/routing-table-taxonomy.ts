/** The classifier question set's taxonomy; a table of another taxonomy cannot activate. */
export const ROUTING_TAXONOMY_VERSION = 2

/** Routable task types in taxonomy order; a table holds exactly one route per entry, in this order. */
export const ROUTING_TASK_TYPES = [
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
] as const
export type RoutingTaskType = (typeof ROUTING_TASK_TYPES)[number]

/** Answers the classifier may give that never route (the primary session rewrites the TaskSpec). */
export const CLASSIFIER_ONLY_TASK_TYPES = ['needs_clarification'] as const

/** The task type that stays in the primary session and has no delegated route. */
export const COORDINATOR_TASK_TYPE = 'coordinator_reasoning'

export const EXECUTION_TARGETS = [
  'claude_primary',
  'claude_subagent',
  'claude_workflow',
  'codex_cli',
  'agy_cli'
] as const
export type ExecutionTarget = (typeof EXECUTION_TARGETS)[number]

/** Why: only these two run inside the primary session's own configuration, which `inherit` refers to. */
export const INHERITING_TARGETS: readonly ExecutionTarget[] = ['claude_primary', 'claude_workflow']

/**
 * Policy levels in order of depth; each target maps them to a CLI setting it supports. D-027 allows
 * none, minimal and ultra: the availability check passes a level only where the CLI lists it.
 */
export const CONCRETE_REASONING_LEVELS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra'
] as const
export type ConcreteReasoningLevel = (typeof CONCRETE_REASONING_LEVELS)[number]

/** Levels a Claude session flag can carry: Orca's Claude launch catalog and the reviewer argv know only these. */
export const CLAUDE_SESSION_FLAG_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

export const INHERIT = 'inherit'
export const REASONING_LEVELS = [...CONCRETE_REASONING_LEVELS, INHERIT] as const

/** `if_supported` is resolved once at the availability check and recorded, never at launch. */
export const REASONING_REQUIREMENTS = ['required', 'if_supported'] as const

/** Headless review runs that may validate a task when no automatic check exists (D-017). */
export const VALIDATION_REVIEWER_TARGETS = ['codex_cli', 'claude_headless'] as const
export type ValidationReviewerTarget = (typeof VALIDATION_REVIEWER_TARGETS)[number]
