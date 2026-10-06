import { describe, expect, it } from 'vitest'
import { PERMISSION_RELAY_FIELD_MAX_CHARS } from '../../../shared/rpc-contract/permission-relay-params'
import { parsePermissionHookInput } from './permission-hook-input'

const HASH = '0123456789abcdef'.repeat(4)

function hookJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    session_id: 'session_fixture',
    transcript_path: '/fixture/transcript.jsonl',
    cwd: '/fixture/repo',
    permission_mode: 'default',
    hook_event_name: 'PermissionRequest',
    tool_name: 'Bash',
    tool_input: { command: 'git status', description: 'Show status' },
    permission_suggestions: [
      { type: 'setMode', mode: 'bypassPermissions', destination: 'session' }
    ],
    ...overrides
  })
}

describe('parsePermissionHookInput', () => {
  it('keeps the tool, the command, the file names, the agent id and the working directory', () => {
    expect(
      parsePermissionHookInput(hookJson({ agent_id: 'agent_fixture01' }), HASH, 240_000)
    ).toEqual({
      toolName: 'Bash',
      agentId: 'agent_fixture01',
      cwd: '/fixture/repo',
      toolInput: { command: 'git status' },
      requestSha256: HASH,
      waitBudgetMs: 240_000
    })
  })

  it('drops file contents, edit strings, descriptions, URLs and permission suggestions', () => {
    const write = parsePermissionHookInput(
      hookJson({
        tool_name: 'Write',
        tool_input: { file_path: '/fixture/repo/a.ts', content: 'export const secret = 1' }
      }),
      HASH,
      240_000
    )
    expect(write?.toolInput).toEqual({ file_path: '/fixture/repo/a.ts' })
    const edit = parsePermissionHookInput(
      hookJson({
        tool_name: 'Edit',
        tool_input: {
          file_path: '/fixture/repo/a.ts',
          old_string: 'a',
          new_string: 'b',
          replace_all: true
        }
      }),
      HASH,
      240_000
    )
    expect(edit?.toolInput).toEqual({ file_path: '/fixture/repo/a.ts' })
    const fetch = parsePermissionHookInput(
      hookJson({
        tool_name: 'WebFetch',
        tool_input: { url: 'https://x.example/?k=v', prompt: 'p' }
      }),
      HASH,
      240_000
    )
    expect(fetch?.toolInput).toEqual({})
    expect(JSON.stringify([write, edit, fetch])).not.toMatch(
      /secret|old_string|bypassPermissions|x\.example/
    )
  })

  it('drops an agent id or working directory it cannot carry safely', () => {
    const parsed = parsePermissionHookInput(
      hookJson({ agent_id: 'agent id with spaces', cwd: 42 }),
      HASH,
      240_000
    )
    expect(parsed).toMatchObject({ agentId: null, cwd: null })
  })

  it('relays nothing for another event, a malformed payload or a field too long to show', () => {
    expect(
      parsePermissionHookInput(hookJson({ hook_event_name: 'PreToolUse' }), HASH, 240_000)
    ).toBeNull()
    expect(parsePermissionHookInput('{not json', HASH, 240_000)).toBeNull()
    expect(parsePermissionHookInput('[]', HASH, 240_000)).toBeNull()
    expect(parsePermissionHookInput(hookJson({ tool_name: 'Bash tool' }), HASH, 240_000)).toBeNull()
    expect(
      parsePermissionHookInput(
        hookJson({ tool_input: { command: 'x'.repeat(PERMISSION_RELAY_FIELD_MAX_CHARS + 1) } }),
        HASH,
        240_000
      )
    ).toBeNull()
  })
})
