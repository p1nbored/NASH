import { describe, expect, it } from 'vitest'
import { parsePermissionHookInput } from './permission-hook-input'
import { runPermissionRequestHook, type PermissionHookIo } from './permission-request-handler'

describe('CLI permission provider adapters', () => {
  it('does not wait for agy to close stdin after a complete UTF-8 object', async () => {
    const stdout: string[] = []
    const bytes = Buffer.from(
      JSON.stringify({ toolCall: { name: 'view_file', args: { AbsolutePath: '/repo/文档' } } })
    )
    const midpoint = bytes.indexOf(Buffer.from('文')) + 1
    await runPermissionRequestHook(
      async () => ({ outcome: 'not_relayed', reason: 'terminal_only_tool' }),
      {
        stdin: (async function* () {
          yield bytes.subarray(0, midpoint)
          yield bytes.subarray(midpoint)
          throw new Error('The vendor pipe has not closed; the complete object should suffice')
        })(),
        writeStdout: (text) => stdout.push(text),
        writeStderr: (text) => {
          throw new Error(text)
        },
        now: () => 0,
        sleep: async () => {}
      },
      'agy'
    )
    expect(JSON.parse(stdout.join(''))).toEqual({ decision: 'ask' })
  })
  it.each([
    ['exec_command', { cmd: 'git status' }],
    ['shell_command', { command: 'git status' }]
  ])('normalizes Codex %s to the command review policy', (tool_name, tool_input) => {
    const parsed = parsePermissionHookInput(
      JSON.stringify({ hook_event_name: 'PermissionRequest', tool_name, tool_input }),
      'a'.repeat(64),
      30_000,
      'codex'
    )
    expect(parsed).toMatchObject({ toolName: 'Bash', toolInput: { command: 'git status' } })
  })
  it('maps agy command arguments without forwarding content or credentials outside the allowlist', () => {
    const input = parsePermissionHookInput(
      JSON.stringify({
        toolCall: {
          name: 'run_command',
          args: { CommandLine: 'npm test', Cwd: '/repo', CodeContent: 'private' }
        },
        workspacePaths: ['/repo']
      }),
      'a'.repeat(64),
      30_000,
      'agy'
    )
    expect(input).toMatchObject({
      toolName: 'Bash',
      cwd: '/repo',
      toolInput: { command: 'npm test' }
    })
    expect(JSON.stringify(input)).not.toContain('private')
  })
  it('keeps Codex patch contents out of the relay', () => {
    const input = parsePermissionHookInput(
      JSON.stringify({
        hook_event_name: 'PermissionRequest',
        tool_name: 'apply_patch',
        tool_input: { command: '*** Begin Patch\n+private\n*** End Patch' },
        cwd: '/repo'
      }),
      'b'.repeat(64),
      30_000,
      'codex'
    )
    expect(input?.toolInput).toEqual({})
    expect(input?.toolName).toBe('apply_patch')
  })
  it.each(['allow', 'deny'] as const)(
    'returns agy %s in its own output protocol',
    async (behavior) => {
      const stdout: string[] = []
      const io: PermissionHookIo = {
        stdin: (async function* () {
          yield JSON.stringify({
            toolCall: { name: 'view_file', args: { AbsolutePath: '/repo/a' } }
          })
        })(),
        writeStdout: (text) => stdout.push(text),
        writeStderr: () => {},
        now: () => 0,
        sleep: async () => {}
      }
      await runPermissionRequestHook(
        async (method) =>
          method.endsWith('Request')
            ? {
                outcome: 'relayed',
                decisionId: 'decision-1',
                deadlineAt: '2026-10-08T00:00:00.000Z'
              }
            : {
                state: 'decided',
                hookOutput: {
                  hookSpecificOutput: {
                    hookEventName: 'PermissionRequest',
                    decision:
                      behavior === 'allow'
                        ? { behavior }
                        : { behavior, message: 'Denied by primary.' }
                  }
                }
              },
        io,
        'agy'
      )
      expect(JSON.parse(stdout.join(''))).toMatchObject({ decision: behavior })
    }
  )
  it('returns ask to agy when relay is unavailable', async () => {
    const stdout: string[] = []
    await runPermissionRequestHook(
      async () => {
        throw new Error('offline')
      },
      {
        stdin: (async function* () {
          yield '{}'
        })(),
        writeStdout: (text) => stdout.push(text),
        writeStderr: () => {},
        now: () => 0,
        sleep: async () => {}
      },
      'agy'
    )
    expect(JSON.parse(stdout.join(''))).toEqual({ decision: 'ask' })
  })
})
