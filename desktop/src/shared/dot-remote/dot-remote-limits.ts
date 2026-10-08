import {
  DOT_DECISION_SUMMARY_MAX_CHARS,
  DOT_INGRESS_ARTIFACT_MAX,
  DOT_INGRESS_CONTRACT_VERSION
} from '../dot-ingress/dot-ingress-limits'

// Protocol constants of the hosted mailbox. Unlike dot-remote-defaults.ts these are not user
// decisions; RG9 keeps short polling until a Sites probe proves a held request.

/**
 * The remote contract between NASH and the Site: heartbeat, presence, tool manifest and vectors. v4
 * (D-034) lets dot ask for workspace_write and publishes each workspace's maxAccess. The Site
 * refuses a heartbeat of any other version, so mixed versions show NASH offline.
 */
export const DOT_REMOTE_CONTRACT_VERSION = 4 as const

/** The dot ingress contract inbox payloads follow; the MCP layer injects it into every one. */
export const DOT_REMOTE_PAYLOAD_CONTRACT_VERSION = DOT_INGRESS_CONTRACT_VERSION

export const DOT_REMOTE_LEASE_SECONDS = 60
export const DOT_REMOTE_MAX_ITEMS_PER_LEASE = 10
export const DOT_REMOTE_POLL_ACTIVE_SECONDS = 5
export const DOT_REMOTE_POLL_IDLE_SECONDS = 30
export const DOT_REMOTE_HEARTBEAT_SECONDS = 30
/** NASH counts as online while its last heartbeat is younger than this. */
export const DOT_REMOTE_ONLINE_WINDOW_SECONDS = 90

export const DOT_REMOTE_EVENT_BATCH_MAX = 50
/** Per request, the newest entries a projection list keeps. */
export const DOT_REMOTE_PROJECTION_LIST_MAX = 50
export const DOT_REMOTE_LIST_DEFAULT_LIMIT = 20
export const DOT_REMOTE_LIST_MAX_LIMIT = 50

/** Hosted rails from plan section 7; the Site enforces them per binding. */
export const DOT_REMOTE_TOOL_CALLS_PER_MINUTE = 30
export const DOT_REMOTE_INBOX_WAITING_MAX = 50
/** Open validation decisions per binding: NASH reports no more at a time and the Site lists no more. */
export const DOT_REMOTE_VALIDATION_DECISIONS_OPEN_MAX = 50

export const DOT_REMOTE_SESSION_TTL_MINUTES = 15
export const DOT_REMOTE_SESSION_RENEW_AFTER_MINUTES = 10
export const DOT_REMOTE_CHALLENGE_TTL_MINUTES = 10
export const DOT_REMOTE_CHALLENGE_POLL_SECONDS = 5

export const DOT_REMOTE_PROMPT_SUMMARY_MAX_CHARS = DOT_DECISION_SUMMARY_MAX_CHARS
export const DOT_REMOTE_VALIDATION_LINE_MAX_CHARS = 300
export const DOT_REMOTE_DELIVERABLE_SUMMARY_MAX_CHARS = 2_000
export const DOT_REMOTE_ARTIFACT_MAX = DOT_INGRESS_ARTIFACT_MAX
