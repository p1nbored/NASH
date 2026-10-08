import { DOT_REQUEST_ACCESS_LEVELS, type DotRequestAccess } from '../dot-ingress/dot-ingress-limits'

// Current policy (docs/dot-mcp.md): the values marked DEFAULT are the recommended
// defaults and are AWAITING USER CONFIRMATION; the one marked DECIDED was settled by the user.
// Changing any of them is a deliberate contract edit that regenerates the goldens.

/** DEFAULT, awaiting user confirmation (decision 2): only summaries and opaque artifact ids leave the PC. */
export const DOT_REMOTE_DELIVERABLE_CONTENTS_SENT = false as const

/**
 * DECIDED (decision 3, D-034): remote submissions may ask for up to this access. Each workspace's
 * maximum, set in NASH, stays the real limit; NASH refuses a request above it.
 */
export const DOT_REMOTE_SUBMIT_ACCESS_CAP: DotRequestAccess = 'workspace_write'

/** DEFAULT, awaiting user confirmation (decision 4): an item not taken within this time expires. */
export const DOT_REMOTE_SUBMIT_TTL_MINUTES = 30

/** DEFAULT, awaiting user confirmation (decision 5): visible retention of receipts and events on the Site. */
export const DOT_REMOTE_RETENTION_DAYS = 7

/** DEFAULT, awaiting user confirmation (decision 6): dot may answer prompts remotely, subject to RG7. */
export const DOT_REMOTE_PERMISSION_ANSWERS_ALLOWED = true as const

/** DEFAULT, awaiting user confirmation: a pairing ends this long after approval; rotation never extends it. */
export const DOT_REMOTE_DEVICE_CREDENTIAL_LIFETIME_DAYS = 30

export const DOT_REMOTE_DEFAULTS_AWAITING_CONFIRMATION = {
  status: 'awaiting_user_confirmation',
  deliverableContentsSent: DOT_REMOTE_DELIVERABLE_CONTENTS_SENT,
  submitTtlMinutes: DOT_REMOTE_SUBMIT_TTL_MINUTES,
  retentionDays: DOT_REMOTE_RETENTION_DAYS,
  permissionAnswersAllowed: DOT_REMOTE_PERMISSION_ANSWERS_ALLOWED,
  deviceCredentialLifetimeDays: DOT_REMOTE_DEVICE_CREDENTIAL_LIFETIME_DAYS
} as const

/** Settled decisions are carried by the manifest as policy.decided. */
export const DOT_REMOTE_DECIDED_POLICY = {
  submitAccessCap: DOT_REMOTE_SUBMIT_ACCESS_CAP
} as const

/** The access levels a request may state, in order, up to and including the cap. */
export function dotRemoteAccessLevelsUpTo(
  cap: DotRequestAccess
): readonly [DotRequestAccess, ...DotRequestAccess[]] {
  const [lowest, ...higher] = DOT_REQUEST_ACCESS_LEVELS
  return [lowest, ...higher.slice(0, DOT_REQUEST_ACCESS_LEVELS.indexOf(cap))]
}

export const DOT_REMOTE_ALLOWED_SUBMIT_ACCESS = dotRemoteAccessLevelsUpTo(
  DOT_REMOTE_SUBMIT_ACCESS_CAP
)
