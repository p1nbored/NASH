import { DOT_REQUEST_ACCESS_LEVELS, type DotRequestAccess } from '../dot-ingress/dot-ingress-limits'

// Plan section 10 (docs/dot-mcp-remote-plan.md): each value below is the recommended DEFAULT and is
// AWAITING USER CONFIRMATION. Changing one is a deliberate contract edit that regenerates the goldens.

/** DEFAULT, awaiting user confirmation (decision 2): only summaries and opaque artifact ids leave the PC. */
export const DOT_REMOTE_DELIVERABLE_CONTENTS_SENT = false as const

/** DEFAULT, awaiting user confirmation (decision 3): remote submissions are capped at this access. */
export const DOT_REMOTE_SUBMIT_ACCESS_CAP: DotRequestAccess = 'read_only'

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
  submitAccessCap: DOT_REMOTE_SUBMIT_ACCESS_CAP,
  submitTtlMinutes: DOT_REMOTE_SUBMIT_TTL_MINUTES,
  retentionDays: DOT_REMOTE_RETENTION_DAYS,
  permissionAnswersAllowed: DOT_REMOTE_PERMISSION_ANSWERS_ALLOWED,
  deviceCredentialLifetimeDays: DOT_REMOTE_DEVICE_CREDENTIAL_LIFETIME_DAYS
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
