import type { WorkspaceLaunchKind } from '../../../shared/workspace-launch-kind'
import type { RateLimitHeadroomState } from './route-provider-headroom'
import type { ModelListing } from './model-listing'
import type { CheckOutcome, LiveRunPrimary } from './route-availability-types'
import type { AgentDetectionReading } from './route-cli-detection-check'
import type { EffortMapping } from './route-effort-mapping'

/** Why a codex launch target could not be resolved: the resolver's own error codes. */
export type CodexExecutableFailureCode = 'not_found' | 'invalid_selection' | 'unexpected'

export type CodexExecutableReading =
  | {
      readonly ok: true
      readonly launch: 'direct' | 'node-entry' | 'powershell-script'
      readonly source: 'explicit' | 'path-search' | 'node-entry'
    }
  | { readonly ok: false; readonly code: CodexExecutableFailureCode }

/** Everything one evaluation observed, read once and shared by every route checked in it. */
export type RouteObservations = {
  readonly nowMs: number
  readonly detection: AgentDetectionReading
  /** The listing of the provider being checked. */
  readonly listing: ModelListing
  readonly rateLimits: RateLimitHeadroomState | null
  /** The workspace the work would run in; null when the evaluation is not about one workspace. */
  readonly workspaceKind: WorkspaceLaunchKind | null
  readonly codexExecutable: CodexExecutableReading
  /** Set only when the caller proved this run's primary session is live. */
  readonly liveRunPrimary: LiveRunPrimary | null
}

export type RouteCheckResult = {
  readonly checks: readonly CheckOutcome[]
  /** The resolved reasoning setting; null when the model could not be matched first. */
  readonly mapping: EffortMapping | null
}
