import { posix, win32 } from 'node:path'

export function pathApiFor(platform: NodeJS.Platform): typeof posix | typeof win32 {
  return platform === 'win32' ? win32 : posix
}

/** A leading double separator names a UNC share or a device path, which can reach the network. */
export function isUncOrDevicePath(path: string): boolean {
  return /^[\\/]{2}/.test(path)
}

/** An absolute local path with no NUL and no UNC or device prefix. */
export function isLocalAbsolutePath(path: unknown, platform: NodeJS.Platform): path is string {
  return (
    typeof path === 'string' &&
    path.length > 0 &&
    !path.includes('\u0000') &&
    !isUncOrDevicePath(path) &&
    pathApiFor(platform).isAbsolute(path)
  )
}

/** True when `candidate` is `root` or lies beneath it; case-folded on win32, no filesystem access. */
export function isPathInside(candidate: string, root: string, platform: NodeJS.Platform): boolean {
  const api = pathApiFor(platform)
  const fold = (value: string): string => (platform === 'win32' ? value.toLowerCase() : value)
  const target = fold(api.resolve(candidate))
  const base = fold(api.resolve(root))
  return target === base || target.startsWith(base.endsWith(api.sep) ? base : `${base}${api.sep}`)
}
