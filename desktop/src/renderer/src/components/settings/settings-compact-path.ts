const SEPARATOR_RUN = /[\\/]+/
const TAIL_SEGMENTS = 2

/**
 * A long folder path as its last two folders behind an ellipsis, so it fits one settings row. The
 * caller keeps the full path in a title or in copied details; short paths are returned unchanged.
 */
export function compactPath(path: string): string {
  const separator = path.includes('\\') && !path.includes('/') ? '\\' : '/'
  const segments = path.split(SEPARATOR_RUN).filter((segment) => segment.length > 0)
  if (segments.length <= TAIL_SEGMENTS + 1) {
    return path
  }
  return `…${separator}${segments.slice(-TAIL_SEGMENTS).join(separator)}`
}
