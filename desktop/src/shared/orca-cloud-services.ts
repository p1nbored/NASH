// User decision 2026-10-05: NASH builds send nothing to Orca's services. Off: Send Feedback and crash
// Send, Orca Cloud sign-in (relay, artifact and skill publishing), shared-skill install from links, the
// plugin safety list and official marketplace, and the Orca Mobile push gateway. Not a user setting;
// an explicit ORCA_* endpoint override still reaches that one service (docs/architecture.md section 17).
export const ORCA_CLOUD_SERVICES_ENABLED = false

/** Refusal code returned when a NASH build declines an Orca cloud request. */
export const ORCA_CLOUD_SERVICES_OFF_CODE = 'orca_cloud_services_off'
