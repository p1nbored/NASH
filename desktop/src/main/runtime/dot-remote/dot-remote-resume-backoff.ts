// The wait before the next refresh after an unreachable Site: 5 s, doubling, at most 5 minutes. The
// device credential is kept throughout; only an answer from the Site can end the pairing.

export const DOT_REMOTE_RESUME_BACKOFF_BASE_MS = 5_000
export const DOT_REMOTE_RESUME_BACKOFF_MAX_MS = 300_000

export function createDotRemoteResumeBackoff() {
  let failures = 0
  return {
    /** The delay after one more failure. */
    next(): number {
      failures += 1
      return Math.min(
        DOT_REMOTE_RESUME_BACKOFF_MAX_MS,
        DOT_REMOTE_RESUME_BACKOFF_BASE_MS * 2 ** (failures - 1)
      )
    },
    reset(): void {
      failures = 0
    }
  }
}
