import { z } from 'zod'

export const AUTOPILOT_RELATIVE_PATH_MAX_CHARS = 1024

/** Mirrors the table CHECK and adds what a unique key needs: no empty, `.` or `..` segments, no trailing slash. */
export function isPlainRelativePath(path: string): boolean {
  if (/\p{Cc}/u.test(path) || path.includes('\\') || path.includes(':')) {
    return false
  }
  if (path.startsWith('/') || path.endsWith('/')) {
    return false
  }
  return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

/** A path under a root the app names itself (a worktree or a run directory), never absolute. */
export const RelativePathSchema = z
  .string()
  .min(1)
  .max(AUTOPILOT_RELATIVE_PATH_MAX_CHARS)
  .refine(isPlainRelativePath)
