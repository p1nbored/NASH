import type {
  ConcreteReasoningLevel,
  ExecutionTarget,
  REASONING_REQUIREMENTS
} from '../../../shared/routing-table/routing-table-taxonomy'
import type { WorkspaceLaunchKind } from '../../../shared/workspace-launch-kind'

/** The CLIs behind the routes; each has its own model listing, login and quota. */
export type RouteProvider = 'claude' | 'codex' | 'agy'

/** Why `claude_headless`: a validation reviewer runs `claude -p` outside the primary session (D-017). */
export type RouteTarget = ExecutionTarget | 'claude_headless'
export type ReasoningRequirement = (typeof REASONING_REQUIREMENTS)[number]

/** What is checked for one route: concrete values only, with `inherit` already resolved to the coordinator. */
export type RouteSubject = {
  readonly target: RouteTarget
  readonly model: string
  readonly reasoningLevel: ConcreteReasoningLevel
  readonly requirement: ReasoningRequirement
  /** True when the table row says `inherit` for both fields, so the values are the coordinator's. */
  readonly inheritsCoordinator: boolean
}

/**
 * Evidence that this run's primary session is live, read by the caller from the primary-session store.
 * An in-session route has no login of its own: it runs inside that session.
 */
export type LiveRunPrimary = { readonly runId: string; readonly ownerId: string }

export function providerForTarget(target: RouteTarget): RouteProvider {
  switch (target) {
    case 'codex_cli':
      return 'codex'
    case 'agy_cli':
      return 'agy'
    case 'claude_primary':
    case 'claude_subagent':
    case 'claude_workflow':
    case 'claude_headless':
      return 'claude'
  }
}

/** Identity of a route for latches: the executor-reported failure belongs to this target, model and level. */
export function routeKeyOf(subject: RouteSubject): string {
  return `${subject.target}|${subject.model}|${subject.reasoningLevel}`
}

/** Certain failures: the route cannot run. */
export const UNAVAILABLE_REASONS = [
  'cli_missing',
  'cli_disabled',
  'cli_not_launchable',
  'model_not_listed',
  'model_excluded',
  'reasoning_unsupported',
  'auth_failed',
  'not_entitled',
  'quota_exhausted',
  'workspace_not_git'
] as const
export type UnavailableReason = (typeof UNAVAILABLE_REASONS)[number]

/** Not proven either way: the route may not run until a check observes it. */
export const UNVERIFIED_REASONS = [
  'cli_unobserved',
  'model_list_unavailable',
  'reasoning_unverified',
  'auth_unobserved'
] as const
export type UnverifiedReason = (typeof UNVERIFIED_REASONS)[number]

export type CheckName = 'cli' | 'model' | 'reasoning' | 'auth' | 'quota' | 'workspace' | 'latch'
/** Small fixed-vocabulary facts behind an outcome; never CLI output, paths or account identifiers. */
export type CheckEvidence = Readonly<Record<string, string | number | boolean | null>>

export type CheckOutcome =
  | { readonly check: CheckName; readonly result: 'pass'; readonly evidence?: CheckEvidence }
  | {
      readonly check: CheckName
      readonly result: 'fail'
      readonly reason: UnavailableReason
      readonly evidence?: CheckEvidence
    }
  | {
      readonly check: CheckName
      readonly result: 'unobserved'
      readonly reason: UnverifiedReason
      readonly evidence?: CheckEvidence
    }

/** How the requested level reached the CLI; none of these is a flag spelling, the runners own those. */
export type EffortDelivery =
  | 'claude_effort_flag'
  | 'claude_agents_field'
  | 'claude_inherited'
  | 'claude_workflow_definition'
  | 'codex_config_override'
  | 'agy_model_id_variant'
  | 'omitted'

/** `if_supported` is resolved once, here, and recorded; launch never decides it again. */
export type ReasoningResolution = 'applied' | 'omitted_unsupported' | 'encoded_in_model_id'

/** The setting a runner passes: the value to send (null sends none), never the flag spelling. */
export type ResolvedCliSetting = {
  readonly target: RouteTarget
  readonly model: string
  readonly effort: string | null
  readonly effortDelivery: EffortDelivery
  readonly requestedLevel: ConcreteReasoningLevel
  readonly requirement: ReasoningRequirement
  readonly resolution: ReasoningResolution
}

export type EvaluateFreshness = 'cached' | 'dispatch' | 'recheck'

export type RouteAvailabilitySnapshot = {
  readonly checkedAtMs: number
  readonly freshness: EvaluateFreshness
  readonly workspaceKind: WorkspaceLaunchKind | null
  readonly checks: readonly CheckOutcome[]
  readonly observedAtMs: {
    readonly detection: number | null
    readonly models: number | null
    readonly rateLimits: number | null
  }
}

export type RouteAvailabilityResult = {
  readonly subject: RouteSubject
  readonly snapshot: RouteAvailabilitySnapshot
} & (
  | {
      readonly status: 'available'
      readonly reasons: readonly []
      readonly cli: ResolvedCliSetting
    }
  | {
      readonly status: 'unavailable'
      readonly reasons: readonly [UnavailableReason, ...UnavailableReason[]]
      readonly cli: null
    }
  | {
      readonly status: 'unverified'
      readonly reasons: readonly [UnverifiedReason, ...UnverifiedReason[]]
      readonly cli: null
    }
)

export type LatchKind = 'auth' | 'quota'
/** Where a latch came from: an executor report, or standing in for a latch file that was lost. */
export type LatchSource = 'executor_reported' | 'availability_file_damaged'
export type RouteLatch = {
  readonly routeKey: string
  readonly kind: LatchKind
  readonly latchedAtMs: number
  /** Absent means `executor_reported`. */
  readonly source?: LatchSource
}

export type AvailableRouteResult = Extract<
  RouteAvailabilityResult,
  { readonly status: 'available' }
>

/** Only an available route dispatches: an unverified one (for example an unobserved login) does not (U7). */
export function isDispatchable(result: RouteAvailabilityResult): result is AvailableRouteResult {
  return result.status === 'available'
}
