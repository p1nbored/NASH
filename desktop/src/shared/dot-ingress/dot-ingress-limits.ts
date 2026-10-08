// Constants of dot ingress contract v3. A change to any value is a deliberate contract edit.
//
// User decision 2026-10-05: tasks sent from dot do not require the user's confirmation. A valid
// submission goes straight through the single intake door under the dot principal. The two safety
// rails below are DEFAULTS the user can change; neither needs a per-task step.

export const DOT_INGRESS_CONTRACT_VERSION = 3 as const
export const DOT_INGRESS_SUPPORTED_CONTRACT_VERSIONS = [3] as const

/** The principal the dot's Workbench requests are filed under; the desktop principal is a different one. */
export const DOT_INGRESS_PRINCIPAL_ID = 'dot-ingress' as const

/** Stored literals: a future mode is a schema bump, never a silent default. */
export const DOT_INGRESS_SOURCE = 'dot_ingress' as const
export const DOT_INGRESS_SENDER_AUTH = 'ingress_token_holder' as const
/** The only data class G1 allows; the contract has no field a sender could use to lower it. */
export const DOT_INGRESS_DATA_CLASS = 'user_task_summary' as const

// DEFAULT RAIL 1 (user can change): dot may only target workspaces the user enabled for dot. This is a
// one-time per-workspace setting made in the app; no workspace is enabled until the user enables it.

// DEFAULT RAIL 2 (user can change, stored in dot_ingress_settings): submission rate caps, counted per
// sliding minute and per UTC day over every row the dot created, whatever its later state.
export const DOT_INGRESS_DEFAULT_RATE_PER_MINUTE = 6
export const DOT_INGRESS_DEFAULT_RATE_PER_UTC_DAY = 100
export const DOT_INGRESS_RATE_PER_MINUTE_MAX = 60
export const DOT_INGRESS_RATE_PER_UTC_DAY_MAX = 10_000
export const DOT_INGRESS_RATE_WINDOW_MS = 60_000

/** Prose outside quoted spans, which is all that reaches Clef; spans are capped by the span parser. */
export const DOT_INGRESS_PROSE_MAX_CHARS = 2_000
/** Rows whose intake call has not finished; only a crash or a failing door leaves one waiting. */
export const DOT_INGRESS_RECEIVED_LIMIT = 20
/** Matches the Workbench store's own retention limit, so the two stores refuse at the same point. */
export const DOT_INGRESS_RETAINED_LIMIT = 10_000
export const DOT_INGRESS_ARTIFACT_MAX = 50
export const DOT_INGRESS_SCAN_RULE_MAX_COUNT = 16

/** Mirrors PERMISSION_SUMMARY_MAX_CHARS in the permission store (U25: 500 characters or less). */
export const DOT_DECISION_SUMMARY_MAX_CHARS = 500
export const DOT_WORKSPACE_LABEL_MAX_CHARS = 120
export const DOT_CORRELATION_ID_MAX_CHARS = 128

/**
 * Access the dot states in its request. It is recorded as given and never upgraded; omitted means
 * read_only.
 */
export const DOT_REQUEST_ACCESS_LEVELS = ['read_only', 'workspace_write'] as const
export type DotRequestAccess = (typeof DOT_REQUEST_ACCESS_LEVELS)[number]
export const DOT_DEFAULT_REQUEST_ACCESS: DotRequestAccess = 'read_only'

/** Why the intake door refused a request that was already recorded; coarse codes, no text. */
export const DOT_SUBMISSION_FAILURES = [
  'workspace_unavailable',
  'capacity_exceeded',
  'intake_refused'
] as const
export type DotSubmissionFailure = (typeof DOT_SUBMISSION_FAILURES)[number]
