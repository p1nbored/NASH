import type { OrcaRuntimeService } from '../orca-runtime'
import { requirePermissionRelay } from '../permission-relay/permission-relay-registry'
import { dotRemoteErrorCode } from './dot-remote-error-code'
import type { DotRemoteLocalReaderPorts } from './dot-remote-local-readers'
import type { DotRemoteLog } from './dot-remote-timers'

// D2's dot prompts for the remote readers. While no relay runs (or a read fails) the list is empty,
// as the readers expect, and the code is logged once per outage so an empty list can be explained.

export function createDotRemoteRelayPrompts(
  runtime: OrcaRuntimeService,
  log: DotRemoteLog
): DotRemoteLocalReaderPorts['listForDot'] {
  let failingCode: string | null = null
  return (runId, options) => {
    try {
      const records = requirePermissionRelay(runtime).listForDot(runId, options)
      failingCode = null
      return records
    } catch (error) {
      const code = dotRemoteErrorCode(error)
      if (code !== failingCode) {
        failingCode = code
        log({ event: 'dot_remote_prompts_unavailable', code })
      }
      return []
    }
  }
}
