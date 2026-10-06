// A `nash` command started inside a real Orca terminal inherits that terminal's ORCA_USER_DATA_PATH,
// which names Orca's profile. NASH ignores such a value and uses its own default profile, so it never
// opens Orca's database, runtime metadata or profile recovery (decision D-017).
// Why only the folder name: Orca derives its profile folder from its package name, so `orca` and
// `orca-dev` are the only names a real install uses; harnesses and smoke scripts keep temp profiles.
const ORCA_PROFILE_DIR_NAMES: ReadonlySet<string> = new Set(['orca', 'orca-dev'])

export function isOrcaProfilePath(path: string): boolean {
  const lastSegment = path
    .trim()
    .split(/[\\/]+/)
    .filter(Boolean)
    .at(-1)
  return lastSegment !== undefined && ORCA_PROFILE_DIR_NAMES.has(lastSegment.toLowerCase())
}

/** The profile the environment points at, or undefined when it is unset or names an Orca profile. */
export function readInheritedUserDataPath(
  env: Readonly<Record<string, string | undefined>> = process.env
): string | undefined {
  const value = env.ORCA_USER_DATA_PATH
  if (!value || value.trim() === '' || isOrcaProfilePath(value)) {
    return undefined
  }
  return value
}
