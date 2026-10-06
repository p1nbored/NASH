import {
  CLAUDE_SESSION_FLAG_LEVELS,
  CONCRETE_REASONING_LEVELS
} from '../../../shared/routing-table/routing-table-taxonomy'
import { CODEX_EXEC_EFFORTS } from '../../codex-exec/codex-exec-types'
import type {
  CheckOutcome,
  EffortDelivery,
  ReasoningRequirement,
  ReasoningResolution,
  RouteTarget
} from './route-availability-types'

/**
 * Policy level -> the setting each installed CLI actually supports (docs/architecture-direction.md
 * section 5: never invent a CLI parameter). Pure: the listing facts arrive as arguments.
 */
export type EffortMapping =
  | {
      readonly status: 'resolved'
      /** The value to send; null sends none. */
      readonly effort: string | null
      readonly delivery: EffortDelivery
      readonly resolution: ReasoningResolution
    }
  | { readonly status: 'unsupported' }
  | { readonly status: 'unverified' }

const UNSUPPORTED: EffortMapping = { status: 'unsupported' }
const UNVERIFIED: EffortMapping = { status: 'unverified' }

type ClaudeDelivery = Extract<
  EffortDelivery,
  'claude_effort_flag' | 'claude_agents_field' | 'claude_inherited' | 'claude_workflow_definition'
>

/** Which Claude mechanism carries the level: the session flag, the agents entry, or the workflow itself. */
export function claudeDeliveryFor(
  target: RouteTarget,
  inheritsCoordinator: boolean
): ClaudeDelivery {
  switch (target) {
    case 'claude_subagent':
      return 'claude_agents_field'
    case 'claude_workflow':
      return inheritsCoordinator ? 'claude_inherited' : 'claude_workflow_definition'
    // Why listed: only Claude targets reach this, and the others are named so the switch stays exhaustive.
    case 'claude_primary':
    case 'claude_headless':
    case 'codex_cli':
    case 'agy_cli':
      return 'claude_effort_flag'
  }
}

function resolved(
  effort: string | null,
  delivery: EffortDelivery,
  resolution: ReasoningResolution
): EffortMapping {
  return { status: 'resolved', effort, delivery, resolution }
}

/**
 * `listedEfforts` is the intersection over the model rows that match; null means no listed model
 * carries effort data at all, which is not the same as one model having none (Haiku 4.5). D-027:
 * the listing decides, so ultra, none or minimal pass wherever the CLI lists them, except on the
 * session flag, whose launchers cannot apply them yet.
 */
export function mapClaudeEffort(input: {
  level: string
  requirement: ReasoningRequirement
  delivery: ClaudeDelivery
  listedEfforts: readonly string[] | null
}): EffortMapping {
  const { level, requirement, delivery, listedEfforts } = input
  if (listedEfforts === null) {
    return UNVERIFIED
  }
  const flagCarries =
    delivery !== 'claude_effort_flag' || CLAUDE_SESSION_FLAG_LEVELS.some((known) => known === level)
  if (flagCarries && listedEfforts.includes(level)) {
    const sent = delivery === 'claude_inherited' || delivery === 'claude_workflow_definition'
    return resolved(sent ? null : level, delivery, 'applied')
  }
  return requirement === 'if_supported'
    ? resolved(null, 'omitted', 'omitted_unsupported')
    : UNSUPPORTED
}

/** The effort is always passed explicitly (the account default differs from the bundled one), so there is no omission. */
export function mapCodexEffort(input: {
  level: string
  listedEfforts: readonly string[]
}): EffortMapping {
  const { level, listedEfforts } = input
  const runnerAccepts = CODEX_EXEC_EFFORTS.some((effort) => effort === level)
  return runnerAccepts && listedEfforts.includes(level)
    ? resolved(level, 'codex_config_override', 'applied')
    : UNSUPPORTED
}

/** agy 1.2.14 lists thinking as variant ids (no `max` variant yet); `--effort` next to a variant id is unproven. */
const AGY_VARIANT_SUFFIX = new RegExp(`^.+-(${CONCRETE_REASONING_LEVELS.join('|')})$`)

/**
 * No effort is ever sent. A level the variant id encodes is recorded as encoded; one it does not (including
 * `max`) is unsupported when required, and recorded as not applied when `if_supported`. A bare id is unverified.
 */
export function mapAgyEffort(input: {
  level: string
  requirement: ReasoningRequirement
  modelId: string
}): EffortMapping {
  const variant = AGY_VARIANT_SUFFIX.exec(input.modelId)?.[1]
  if (variant === undefined) {
    return UNVERIFIED
  }
  if (variant === input.level) {
    return resolved(null, 'agy_model_id_variant', 'encoded_in_model_id')
  }
  // Why no sibling variant: the pinned id fixes its own thinking, and a swap would be a silent substitution.
  return input.requirement === 'if_supported'
    ? resolved(null, 'agy_model_id_variant', 'omitted_unsupported')
    : UNSUPPORTED
}

/** The reasoning check outcome for a mapping; the mapping itself carries what the runner needs. */
export function reasoningCheckOf(mapping: EffortMapping): CheckOutcome {
  switch (mapping.status) {
    case 'resolved':
      return {
        check: 'reasoning',
        result: 'pass',
        evidence: { resolution: mapping.resolution }
      }
    case 'unsupported':
      return { check: 'reasoning', result: 'fail', reason: 'reasoning_unsupported' }
    case 'unverified':
      return { check: 'reasoning', result: 'unobserved', reason: 'reasoning_unverified' }
  }
}
