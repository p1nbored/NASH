import type { WorkbenchDotRemoteSyncFailure } from '../../../shared/rpc-contract/workbench-dot-remote-params'

// Polls that threw in a row. A thrown poll (a store call failed) leaves the connection state at
// connected, so the status shows this once it repeats; a poll that does not throw clears it.

/** Below this a thrown poll is retried quietly; a single busy database is not worth a warning. */
export const DOT_REMOTE_SYNC_FAILING_AFTER = 3

export function createDotRemoteSyncHealth(now: () => number) {
  let failures = 0
  let lastCode = ''
  let sinceMs = 0
  return {
    /** A poll threw; `code` is the log-safe code, never the error's message. */
    failed(code: string): void {
      if (failures === 0) {
        sinceMs = now()
      }
      failures += 1
      lastCode = code
    },
    /** A poll ran without throwing, or polling was halted (switch, revoke, origin change). */
    clear(): void {
      failures = 0
    },
    view(): WorkbenchDotRemoteSyncFailure | null {
      return failures < DOT_REMOTE_SYNC_FAILING_AFTER
        ? null
        : { consecutiveFailures: failures, lastCode, since: new Date(sinceMs).toISOString() }
    }
  }
}

export type DotRemoteSyncHealth = ReturnType<typeof createDotRemoteSyncHealth>
