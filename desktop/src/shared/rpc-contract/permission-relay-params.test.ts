import { describe, expect, it } from 'vitest'
import {
  PERMISSION_RELAY_FIELD_MAX_CHARS,
  PERMISSION_RELAY_INPUT_KEYS,
  PERMISSION_RELAY_WAIT_MS,
  PERMISSION_WAIT_SLICE_MAX_MS,
  PermissionHookOutputSchema,
  PermissionRequestParams,
  PermissionRequestResultSchema,
  PermissionWaitParams,
  PermissionWaitResultSchema,
  WorkbenchPermissionAnswerParams,
  WorkbenchPermissionListParams
} from './permission-relay-params'
import { PERMISSION_RELAY_WAIT_SECONDS } from '../workflow-run/autopilot-cli-commands'

const HASH = '0123456789abcdef'.repeat(4)

function request(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    toolName: 'Bash',
    agentId: null,
    cwd: '/fixture/repo',
    toolInput: { command: 'git status' },
    requestSha256: HASH,
    waitBudgetMs: PERMISSION_RELAY_WAIT_MS,
    ...overrides
  }
}

describe('permission relay params', () => {
  it('waits exactly the relay seconds A3 put in the settings file, in slices of 20 s or less', () => {
    expect(PERMISSION_RELAY_WAIT_MS).toBe(PERMISSION_RELAY_WAIT_SECONDS * 1000)
    expect(PERMISSION_WAIT_SLICE_MAX_MS).toBeLessThanOrEqual(20_000)
  })

  it('forwards only command and file name keys, never content keys', () => {
    expect([...PERMISSION_RELAY_INPUT_KEYS].sort()).toEqual(
      ['command', 'file_path', 'notebook_path', 'path', 'pattern'].sort()
    )
    for (const contentKey of [
      'content',
      'old_string',
      'new_string',
      'new_source',
      'edits',
      'url'
    ]) {
      const parsed = PermissionRequestParams.safeParse(
        request({ toolInput: { command: 'x', [contentKey]: 'secret body' } })
      )
      expect(parsed.success, contentKey).toBe(false)
    }
  })

  it('accepts a well-formed request and refuses unknown top-level fields', () => {
    expect(PermissionRequestParams.safeParse(request()).success).toBe(true)
    expect(PermissionRequestParams.safeParse(request({ toolInputRaw: '{}' })).success).toBe(false)
  })

  it('bounds every forwarded field and the wait budget', () => {
    const long = 'a'.repeat(PERMISSION_RELAY_FIELD_MAX_CHARS + 1)
    expect(
      PermissionRequestParams.safeParse(request({ toolInput: { command: long } })).success
    ).toBe(false)
    expect(PermissionRequestParams.safeParse(request({ waitBudgetMs: 999 })).success).toBe(false)
    expect(
      PermissionRequestParams.safeParse(request({ waitBudgetMs: PERMISSION_RELAY_WAIT_MS + 1 }))
        .success
    ).toBe(false)
    expect(PermissionRequestParams.safeParse(request({ requestSha256: 'ABC' })).success).toBe(false)
    expect(PermissionRequestParams.safeParse(request({ toolName: 'Bash tool' })).success).toBe(
      false
    )
  })

  it('caps a server wait at the slice limit', () => {
    const id = '11111111-2222-4333-8444-555555555555'
    expect(PermissionWaitParams.safeParse({ decisionId: id, waitMs: 20_000 }).success).toBe(true)
    expect(PermissionWaitParams.safeParse({ decisionId: id, waitMs: 20_001 }).success).toBe(false)
    expect(PermissionWaitParams.safeParse({ decisionId: id, waitMs: 0 }).success).toBe(false)
  })

  describe('hook output (hooks.md, PermissionRequest decision control)', () => {
    it('accepts allow and deny with a message, exactly as documented', () => {
      const allow = {
        hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } }
      }
      const deny = {
        hookSpecificOutput: {
          hookEventName: 'PermissionRequest',
          decision: { behavior: 'deny', message: 'Denied by the user through dot.' }
        }
      }
      expect(PermissionHookOutputSchema.parse(allow)).toEqual(allow)
      expect(PermissionHookOutputSchema.parse(deny)).toEqual(deny)
    })

    it('refuses updatedPermissions, updatedInput, interrupt and any invented field', () => {
      const withDecision = (decision: Record<string, unknown>) => ({
        hookSpecificOutput: { hookEventName: 'PermissionRequest', decision }
      })
      const refused = [
        withDecision({ behavior: 'allow', updatedPermissions: [] }),
        withDecision({ behavior: 'allow', updatedInput: { command: 'ls' } }),
        withDecision({ behavior: 'deny', message: 'no', interrupt: true }),
        withDecision({ behavior: 'allow', message: 'only deny has a message' }),
        withDecision({ behavior: 'ask' }),
        { hookSpecificOutput: { hookEventName: 'PreToolUse', decision: { behavior: 'allow' } } },
        {
          hookSpecificOutput: {
            hookEventName: 'PermissionRequest',
            decision: { behavior: 'allow' }
          },
          systemMessage: 'extra'
        }
      ]
      for (const output of refused) {
        expect(PermissionHookOutputSchema.safeParse(output).success).toBe(false)
      }
    })
  })

  it('describes the relay outcomes the CLI acts on', () => {
    expect(
      PermissionRequestResultSchema.safeParse({
        outcome: 'relayed',
        decisionId: 'decision_1',
        deadlineAt: '2026-10-05T00:04:00.000Z'
      }).success
    ).toBe(true)
    expect(
      PermissionRequestResultSchema.safeParse({
        outcome: 'not_relayed',
        reason: 'terminal_only_tool'
      }).success
    ).toBe(true)
    expect(PermissionWaitResultSchema.safeParse({ state: 'pending' }).success).toBe(true)
    expect(PermissionWaitResultSchema.safeParse({ state: 'no_decision' }).success).toBe(true)
    expect(
      PermissionWaitResultSchema.safeParse({
        state: 'decided',
        hookOutput: {
          hookSpecificOutput: {
            hookEventName: 'PermissionRequest',
            decision: { behavior: 'allow', updatedPermissions: [] }
          }
        }
      }).success
    ).toBe(false)
  })

  it('lets the desktop list and answer with closed vocabularies', () => {
    expect(WorkbenchPermissionListParams.safeParse({}).success).toBe(true)
    expect(
      WorkbenchPermissionListParams.safeParse({ runId: 'run_1', statuses: ['pending'], limit: 50 })
        .success
    ).toBe(true)
    expect(WorkbenchPermissionListParams.safeParse({ statuses: ['waiting'] }).success).toBe(false)
    expect(
      WorkbenchPermissionAnswerParams.safeParse({ decisionId: 'decision_1', decision: 'allow' })
        .success
    ).toBe(true)
    expect(
      WorkbenchPermissionAnswerParams.safeParse({ decisionId: 'decision_1', decision: 'allowed' })
        .success
    ).toBe(false)
  })
})
