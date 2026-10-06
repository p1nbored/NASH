const CLEF_ENVIRONMENT_NAMES: ReadonlySet<string> = new Set([
  'AUTOPILOT_CLEF_API_TOKEN',
  'AUTOPILOT_CLEF_ACCOUNT_ID'
])

/**
 * Deletes the Clef credential variables, in any letter case, from `env` without reading
 * their values, and returns the names it removed. Startup applies it to `process.env`
 * before the daemon, renderer or any child exists (D-012: credentials are never env vars).
 */
export function scrubClefEnvironment(env: Record<string, string | undefined>): string[] {
  // Why: Object.keys never invokes getters, so values stay unread.
  const removed = Object.keys(env).filter((name) => CLEF_ENVIRONMENT_NAMES.has(name.toUpperCase()))
  for (const name of removed) {
    // Why: process.env cannot be swapped for a copy, so the scrub has to delete in place.
    delete env[name]
  }
  return removed
}
