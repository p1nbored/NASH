import { CLAUDE_SESSION_FLAG_LEVELS } from '../../../shared/routing-table/routing-table-taxonomy'

/** Shared types, refusal codes and input checks for the pure primary-session launch helpers. */

export const PRIMARY_SESSION_ACCESS_VALUES = ['read_only', 'workspace_write'] as const
export type PrimarySessionAccess = (typeof PRIMARY_SESSION_ACCESS_VALUES)[number]

/** The only two Claude Code permission modes the app may start a session in. */
export const PRIMARY_PERMISSION_MODES = ['manual', 'acceptEdits'] as const
export type PrimaryPermissionMode = (typeof PRIMARY_PERMISSION_MODES)[number]

// D-027: every policy level for subagent entries; the route check passes one only where Claude lists it.
export const CLAUDE_EFFORT_LEVELS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra'
] as const
export type ClaudeEffortLevel = (typeof CLAUDE_EFFORT_LEVELS)[number]
/** The coordinator's effort goes through Orca's Claude launch catalog, which applies only these. */
export const COORDINATOR_EFFORT_LEVELS: readonly ClaudeEffortLevel[] = CLAUDE_SESSION_FLAG_LEVELS

/** The five execution targets of the Routing Table (architecture-direction.md section 5). */
export const ROUTE_EXECUTION_TARGETS = [
  'claude_primary',
  'claude_subagent',
  'claude_workflow',
  'codex_cli',
  'agy_cli'
] as const

/**
 * One Routing Table row, in the minimal shape this package needs. The table package owns the real
 * row type; the launcher maps its rows onto this shape (task_type, execution_target, model and the
 * resolved Claude effort), so this package imports nothing from it.
 */
export type SubagentRouteRowInput = {
  readonly taskType: string
  readonly executionTarget: string
  readonly model: string
  readonly effort: string
}

/** Codes carry the autopilot_session_ prefix so the RPC layer can pass them through unchanged. */
export const PRIMARY_SESSION_REFUSAL_CODES = [
  'autopilot_session_posture_invalid',
  'autopilot_session_forbidden_arg',
  'autopilot_session_cli_name_invalid',
  'autopilot_session_model_invalid',
  'autopilot_session_agents_invalid',
  'autopilot_session_objective_invalid',
  'autopilot_session_language_invalid',
  'autopilot_session_settings_path_invalid',
  'autopilot_session_settings_write_failed',
  'autopilot_session_settings_not_owner_only',
  'autopilot_session_command_override',
  'autopilot_session_unsupported_shell',
  'autopilot_session_quoting_unsafe',
  'autopilot_session_startup_plan_unavailable',
  'autopilot_session_startup_plan_mismatch'
] as const
export type PrimarySessionRefusalCode = (typeof PRIMARY_SESSION_REFUSAL_CODES)[number]

export type PrimarySessionRefusal = {
  readonly code: PrimarySessionRefusalCode
  /** English text for the blocker detail; never carries file contents or secrets. */
  readonly detail: string
}

export type PrimarySessionResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly refusal: PrimarySessionRefusal }

export function primarySessionOk<T>(value: T): PrimarySessionResult<T> {
  return { ok: true, value }
}

export function primarySessionRefused<T = never>(
  code: PrimarySessionRefusalCode,
  detail: string
): PrimarySessionResult<T> {
  return { ok: false, refusal: { code, detail } }
}

// Why: a full model id only. Aliases, `inherit`, `latest` and non-Claude ids are routing-table
// policy refusals, and `[`, quotes and spaces would also break shell quoting of the argument.
const CLAUDE_MODEL_ID = /^claude-[a-z0-9][a-z0-9.-]{0,90}$/

export type ClaudeModelChoice = { readonly model: string; readonly effort: ClaudeEffortLevel }

function isEffortIn(
  levels: readonly ClaudeEffortLevel[],
  value: unknown
): value is ClaudeEffortLevel {
  return levels.some((level) => level === value)
}

/** Checks a model and effort read from the table before they reach a CLI argument; the coordinator's levels by default. */
export function parseClaudeModelChoice(
  model: unknown,
  effort: unknown,
  levels: readonly ClaudeEffortLevel[] = COORDINATOR_EFFORT_LEVELS
): PrimarySessionResult<ClaudeModelChoice> {
  if (typeof model !== 'string' || !CLAUDE_MODEL_ID.test(model)) {
    return primarySessionRefused(
      'autopilot_session_model_invalid',
      'The model must be a full Claude model id such as claude-opus-5-5.'
    )
  }
  if (!isEffortIn(levels, effort)) {
    return primarySessionRefused(
      'autopilot_session_model_invalid',
      `The effort must be one of ${levels.join(', ')}.`
    )
  }
  return primarySessionOk({ model, effort })
}
