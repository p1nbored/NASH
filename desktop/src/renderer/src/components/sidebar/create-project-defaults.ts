import { APP_DEFAULT_PROJECTS_DIR_SEGMENTS } from '../../../../shared/app-identity-paths'

export type GitAvailability = 'checking' | 'available' | 'unavailable' | 'unknown'

// Why the shared constant: main and the CLI default to the same NASH folder, never a real Orca install's (D-017).
const HOME_PROJECTS_SUMMARY = `~/${APP_DEFAULT_PROJECTS_DIR_SEGMENTS.join('/')}`
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const HOME_ROOT = String.raw`^(?:/(?:Users|home)/[^/]+|[A-Za-z]:[\\/]Users[\\/][^\\/]+)`
const SEPARATOR = String.raw`[\\/]`
const HOME_PROJECTS_FALLBACK = new RegExp(
  `${HOME_ROOT}${APP_DEFAULT_PROJECTS_DIR_SEGMENTS.map((segment) => SEPARATOR + escapeRegExp(segment)).join('')}$`
)

function pathSeparatorFor(pathValue: string): '/' | '\\' {
  return pathValue.includes('\\') ? '\\' : '/'
}

/** True only for `{home}/nash/projects` on the usual OS home layouts. A configured
 *  directory that merely ends in `nash/projects` (e.g. `/data/nash/projects`) must
 *  stay verbatim — the `~` shorthand would otherwise lie. */
function isHomeProjectsFallback(pathValue: string): boolean {
  return HOME_PROJECTS_FALLBACK.test(pathValue)
}

function trimTrailingSeparators(pathValue: string): string {
  const trimmed = pathValue.replace(/[\\/]+$/, '')
  if (trimmed === '' && pathValue.startsWith('/')) {
    return '/'
  }
  if (/^[A-Za-z]:$/.test(trimmed)) {
    return `${trimmed}${pathSeparatorFor(pathValue)}`
  }
  return trimmed
}

export function joinCreateProjectPath(parentPath: string, childName: string): string {
  const parent = trimTrailingSeparators(parentPath.trim())
  const child = childName.trim().replace(/^[\\/]+/, '')
  if (!parent || !child) {
    return parent || child
  }
  const separator = pathSeparatorFor(parent)
  if (parent === '/' || /^[A-Za-z]:[\\/]$/.test(parent)) {
    return `${parent}${child}`
  }
  return `${parent}${separator}${child}`
}

export function getDefaultCreateProjectParent(homeDir: string): string {
  const trimmedHomeDir = trimTrailingSeparators(homeDir.trim())
  if (!trimmedHomeDir) {
    return ''
  }
  return APP_DEFAULT_PROJECTS_DIR_SEGMENTS.reduce(joinCreateProjectPath, trimmedHomeDir)
}

export function getCreateProjectDefaultParentAutoFill({
  step,
  createParent,
  activeRuntimeEnvironmentId,
  defaultParent,
  createStepAutoFilled
}: {
  step: string
  createParent: string
  activeRuntimeEnvironmentId: string | null | undefined
  defaultParent?: string
  createStepAutoFilled: boolean
}): { parent: string } | null {
  if (step !== 'create' || createStepAutoFilled || createParent) {
    return null
  }
  if (activeRuntimeEnvironmentId?.trim()) {
    return null
  }
  const parent = defaultParent ?? ''
  if (!parent) {
    return null
  }
  return { parent }
}

export function formatCreateProjectParentSummary({
  parent,
  defaultParent,
  runtimeEnvironmentId,
  isRemoteHost,
  missingLocationLabel = 'location not selected',
  missingServerLocationLabel = 'host folder not selected'
}: {
  parent: string
  defaultParent: string
  runtimeEnvironmentId?: string | null
  isRemoteHost?: boolean
  missingLocationLabel?: string
  missingServerLocationLabel?: string
}): string {
  const trimmedParent = parent.trim()
  if (!trimmedParent) {
    return runtimeEnvironmentId || isRemoteHost ? missingServerLocationLabel : missingLocationLabel
  }
  if (
    defaultParent &&
    trimmedParent === defaultParent &&
    !runtimeEnvironmentId &&
    !isRemoteHost &&
    isHomeProjectsFallback(trimmedParent)
  ) {
    return HOME_PROJECTS_SUMMARY
  }
  return trimmedParent
}
