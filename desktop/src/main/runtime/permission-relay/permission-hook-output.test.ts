import { describe, expect, it } from 'vitest'
import type { PermissionDecisionRecord } from '../orchestration/db/permission-decision-store'
import { buildPermissionHookOutput } from './permission-hook-output'

function record(overrides: Partial<PermissionDecisionRecord>): PermissionDecisionRecord {
  return {
    decisionId: 'decision_fixture01',
    runId: 'run_fixture01',
    ownerId: 'owner_fixture01',
    agentId: null,
    toolName: 'Bash',
    summary: 'Bash: git status',
    requestSha256: 'a'.repeat(64),
    status: 'pending',
    decidedBy: null,
    createdAt: '2026-10-05T00:00:00.000Z',
    deadlineAt: '2026-10-05T00:04:00.000Z',
    decidedAt: null,
    ...overrides
  }
}

describe('permission hook output', () => {
  it('prints the documented allow decision and nothing else', () => {
    const output = buildPermissionHookOutput(
      record({ status: 'allowed', decidedBy: 'dot', decidedAt: '2026-10-05T00:01:00.000Z' })
    )
    expect(output).toEqual({
      hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } }
    })
    expect(JSON.stringify(output)).not.toMatch(/updatedPermissions|updatedInput|interrupt/)
  })

  it('prints a deny decision with an English message naming who denied it', () => {
    const byDot = buildPermissionHookOutput(
      record({ status: 'denied', decidedBy: 'dot', decidedAt: '2026-10-05T00:01:00.000Z' })
    )
    const byDesktop = buildPermissionHookOutput(
      record({ status: 'denied', decidedBy: 'desktop', decidedAt: '2026-10-05T00:01:00.000Z' })
    )
    expect(byDot).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'deny', message: 'The user denied this request through dot.' }
      }
    })
    expect(byDesktop?.hookSpecificOutput.decision).toEqual({
      behavior: 'deny',
      message: 'The user denied this request in the desktop app.'
    })
  })

  it('prints nothing for every state that is not an answer from dot or the desktop', () => {
    expect(buildPermissionHookOutput(record({}))).toBeNull()
    expect(
      buildPermissionHookOutput(
        record({ status: 'expired', decidedAt: '2026-10-05T00:04:00.000Z' })
      )
    ).toBeNull()
    expect(
      buildPermissionHookOutput(
        record({
          status: 'answered_in_terminal',
          decidedBy: 'terminal',
          decidedAt: '2026-10-05T00:01:00.000Z'
        })
      )
    ).toBeNull()
  })
})
