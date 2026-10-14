import type { AiVaultServicePendingCall } from './session-scanner-service-client-state'
import type { AiVaultServiceRequest } from './session-scanner-service-protocol'

/** No-progress window: a scan whose work keeps advancing re-arms it, however long it runs. */
export const AI_VAULT_SERVICE_SCAN_TIMEOUT_MS = 130_000
export const AI_VAULT_SERVICE_INTERACTIVE_TIMEOUT_MS = 15_000

function armAiVaultServiceRequestDeadline(
  call: AiVaultServicePendingCall,
  onTimeout: (error: Error) => void
): void {
  const timeoutMs =
    call.request.operation === 'scan'
      ? AI_VAULT_SERVICE_SCAN_TIMEOUT_MS
      : AI_VAULT_SERVICE_INTERACTIVE_TIMEOUT_MS
  if (call.timer) {
    clearTimeout(call.timer)
  }
  // Same text for both meanings: remote clients humanize it, so a new wording
  // would reach older ones as "stopped unexpectedly".
  call.timer = setTimeout(() => {
    onTimeout(new Error(`AI Vault service timed out after ${timeoutMs}ms.`))
  }, timeoutMs)
  call.timer.unref?.()
}

/** Starts the request deadline only once the child is ready to receive it. */
export function sendAiVaultServiceCall(
  // Only the send this needs, so the module stays off the direct child_process import list.
  child: { send(request: AiVaultServiceRequest): unknown },
  call: AiVaultServicePendingCall,
  isActive: () => boolean,
  onTimeout: (error: Error) => void
): void {
  if (call.cancelled || !isActive()) {
    return
  }
  armAiVaultServiceRequestDeadline(call, onTimeout)
  call.sent = true
  child.send(call.request)
}

/**
 * Restarts a running scan's no-progress window when its counter advanced.
 * A cancelled call keeps its two-second acknowledgement bound, and interactive
 * calls keep their fixed one, so only a live scan's own work can extend it.
 */
export function noteAiVaultServiceScanProgress(
  call: AiVaultServicePendingCall,
  units: number,
  onTimeout: (error: Error) => void
): void {
  if (
    call.cancelled ||
    !call.sent ||
    call.request.operation !== 'scan' ||
    units <= call.progressUnits
  ) {
    return
  }
  call.progressUnits = units
  armAiVaultServiceRequestDeadline(call, onTimeout)
}
