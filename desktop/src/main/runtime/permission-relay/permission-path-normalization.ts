/**
 * Paths as the permission checks compare them (security review M1): lower case, `.` and `..`
 * resolved, and trailing dots and spaces dropped from each segment as Windows does. A form whose
 * target no name check can see (a device prefix, a colon after the drive, an 8.3 short name or a
 * segment of only dots) yields null, which the callers treat as desktop-only.
 */
const DEVICE_PREFIX = /^(?:[\\/]{2}[?.](?:[\\/]|$)|\\\?\?\\)/
const DRIVE = /^[a-z]:/i
const ROOTED = /^(?:[\\/~]|[a-z]:)/i
const SEPARATORS = /[\\/]+/
const SHORT_NAME = /~\d/
const DOTS_AND_SPACES_ONLY = /^[. ]+$/
const TRAILING_DOTS_AND_SPACES = /[. ]+$/

/** The raw segments, lower case, exactly as written. */
export function rawSegmentsOf(path: string): string[] {
  return path
    .toLowerCase()
    .split(SEPARATORS)
    .filter((segment) => segment.length > 0)
}

/** `path` resolved against `base` when it is relative; a rooted or home path stays as it is. */
export function joinForMatching(base: string | null, path: string): string {
  return base && !ROOTED.test(path) ? `${base}/${path}` : path
}

/** Resolves `.` and `..` lexically; null for a segment Windows would read as something else. */
function resolveSegments(body: string, absolute: boolean): string[] | null {
  const resolved: string[] = []
  for (const segment of rawSegmentsOf(body)) {
    if (segment === '.') {
      continue
    }
    if (segment === '..') {
      if (resolved.length > 0 && resolved.at(-1) !== '..') {
        resolved.pop()
      } else if (!absolute) {
        resolved.push('..')
      }
      continue
    }
    if (DOTS_AND_SPACES_ONLY.test(segment) || SHORT_NAME.test(segment)) {
      return null
    }
    resolved.push(segment.replace(TRAILING_DOTS_AND_SPACES, ''))
  }
  return resolved
}

/** The segments as the checks compare them, or null for an alias form (see the module note). */
export function normalizePathForMatching(
  path: string,
  base: string | null = null
): readonly string[] | null {
  const joined = joinForMatching(base, path)
  if (DEVICE_PREFIX.test(joined)) {
    return null
  }
  const body = joined.replace(DRIVE, '')
  if (body.includes(':')) {
    return null
  }
  return resolveSegments(body, /^[\\/]/.test(body))
}

/**
 * True when the directory's segments appear in the path, wherever they start: a drive letter, a
 * `/c/` or `/mnt/c/` mount or a `\\host\c$` share in front of them reaches the same folder.
 */
export function containsDirectory(
  segments: readonly string[],
  directory: readonly string[]
): boolean {
  if (directory.length === 0) {
    return false
  }
  for (let start = 0; start + directory.length <= segments.length; start += 1) {
    if (directory.every((segment, index) => segments[start + index] === segment)) {
      return true
    }
  }
  return false
}
