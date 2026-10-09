// NASH disables Orca Cloud sign-in, relay, publishing, shared-skill links and mobile push.
// The official plugin marketplace and safety feed use Orca's native plugin-system lifecycle.
// Explicit ORCA_* endpoint overrides still reach that individual service.
export const ORCA_CLOUD_SERVICES_ENABLED = false

/** Refusal code returned when a NASH build declines an Orca cloud request. */
export const ORCA_CLOUD_SERVICES_OFF_CODE = 'orca_cloud_services_off'
