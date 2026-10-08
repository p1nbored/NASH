import {
  PermissionHookOutputSchema,
  type PermissionHookOutput,
  type PermissionWaitResult
} from '../../../shared/rpc-contract/permission-relay-params'
import type { PermissionDecisionRecord } from '../orchestration/db/permission-decision-store'

const DENY_MESSAGES = {
  primary: 'The primary agent denied this request.',
  dot: 'The user denied this request through dot.',
  desktop: 'The user denied this request in the desktop app.'
} as const

/**
 * The PermissionRequest hook's stdout for an answer from dot or the desktop, in the shape Claude
 * Code's hooks reference documents: `hookSpecificOutput.decision.behavior`, plus `message` on a
 * deny. It never carries `updatedPermissions`, `updatedInput` or `interrupt`. Every other state
 * returns null: the hook prints nothing and Claude Code shows, or already took, its own dialog.
 */
export function buildPermissionHookOutput(
  record: PermissionDecisionRecord
): PermissionHookOutput | null {
  if (record.status === 'allowed') {
    return PermissionHookOutputSchema.parse({
      hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } }
    })
  }
  if (
    record.status === 'denied' &&
    (record.decidedBy === 'dot' || record.decidedBy === 'desktop' || record.decidedBy === 'primary')
  ) {
    return PermissionHookOutputSchema.parse({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'deny', message: DENY_MESSAGES[record.decidedBy] }
      }
    })
  }
  return null
}

/**
 * What one wait slice returns for the prompt as stored now: the decision once dot or the desktop
 * answered, `no_decision` once the relay wait is over or the prompt closed another way, and null
 * while the hook should keep waiting.
 */
export function relayWaitOutcome(
  record: PermissionDecisionRecord | null,
  now: number
): PermissionWaitResult | null {
  if (!record) {
    return { state: 'no_decision' }
  }
  const hookOutput = buildPermissionHookOutput(record)
  if (hookOutput) {
    return { state: 'decided', hookOutput }
  }
  const relayOver = now >= Date.parse(record.deadlineAt)
  return record.status !== 'pending' || relayOver ? { state: 'no_decision' } : null
}
