import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { PERMISSION_HOOK_TIMEOUT_SECONDS } from '../../../shared/workflow-run/autopilot-cli-commands'
import { RuntimeClientError } from '../../runtime/types'
import {
  ORCHESTRATION_PERMISSION_HANDLERS,
  runPermissionRequestHook,
  type PermissionHookIo,
  type PermissionHookRpc
} from './permission-request-handler'

const ALLOW = {
  hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } }
}
const DECISION_ID = '11111111-2222-4333-8444-555555555555'

function hookStdin(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    session_id: 'session_fixture',
    cwd: '/fixture/repo',
    hook_event_name: 'PermissionRequest',
    tool_name: 'Bash',
    tool_input: { command: 'git status' },
    ...overrides
  })
}

function fakeIo(stdin: string) {
  let clock = 1_000_000
  const out: string[] = []
  const err: string[] = []
  const io: PermissionHookIo = {
    stdin: (async function* () {
      yield Buffer.from(stdin, 'utf8')
    })(),
    writeStdout: (text) => out.push(text),
    writeStderr: (text) => err.push(text),
    now: () => clock,
    sleep: async (ms) => {
      clock += ms
    }
  }
  return { io, out, err, advance: (ms: number) => (clock += ms), now: () => clock }
}

type Reply = unknown | Error

function scriptedRpc(replies: { request: Reply; waits: Reply[] }, advance?: (ms: number) => void) {
  const waits = [...replies.waits]
  const rpc = vi.fn<PermissionHookRpc>(async (method, params) => {
    if (method === 'orchestration.permissionRequest') {
      if (replies.request instanceof Error) {
        throw replies.request
      }
      return replies.request
    }
    const next = waits.length > 1 ? waits.shift() : waits[0]
    if (advance && typeof params === 'object' && params !== null && 'waitMs' in params) {
      advance(Number(params.waitMs))
    }
    if (next instanceof Error) {
      throw next
    }
    return next
  })
  return rpc
}

const RELAYED = {
  outcome: 'relayed',
  decisionId: DECISION_ID,
  deadlineAt: '2026-10-05T00:04:00.000Z'
}

describe('orchestration permission-request hook command', () => {
  it('is exported under the hidden command key', () => {
    expect(Object.keys(ORCHESTRATION_PERMISSION_HANDLERS)).toEqual([
      'orchestration permission-request'
    ])
  })

  it('prints exactly the decision JSON when dot or the desktop answers', async () => {
    const stdin = hookStdin()
    const { io, out, err } = fakeIo(stdin)
    const rpc = scriptedRpc({
      request: RELAYED,
      waits: [{ state: 'pending' }, { state: 'decided', hookOutput: ALLOW }]
    })
    await runPermissionRequestHook(rpc, io)
    expect(out.join('')).toBe(`${JSON.stringify(ALLOW)}\n`)
    expect(err).toEqual([])
    const [, params] = rpc.mock.calls[0] ?? []
    expect(params).toEqual({
      toolName: 'Bash',
      agentId: null,
      cwd: '/fixture/repo',
      toolInput: { command: 'git status' },
      requestSha256: createHash('sha256').update(stdin).digest('hex'),
      waitBudgetMs: 240_000
    })
    expect(
      rpc.mock.calls.slice(1).every(([method]) => method === 'orchestration.permissionWait')
    ).toBe(true)
  })

  it('never sends file contents to the app', async () => {
    const { io } = fakeIo(
      hookStdin({
        tool_name: 'Write',
        tool_input: { file_path: '/fixture/repo/a.ts', content: 'body-marker' }
      })
    )
    const rpc = scriptedRpc({
      request: { outcome: 'not_relayed', reason: 'terminal_only_tool' },
      waits: []
    })
    await runPermissionRequestHook(rpc, io)
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('body-marker')
  })

  it('prints nothing when no answer arrives before the deadline, so the terminal dialog shows', async () => {
    const { io, out } = fakeIo(hookStdin())
    const rpc = scriptedRpc({
      request: RELAYED,
      waits: [{ state: 'pending' }, { state: 'pending' }, { state: 'no_decision' }]
    })
    await runPermissionRequestHook(rpc, io)
    expect(out).toEqual([])
  })

  it('prints nothing for a prompt the app leaves to the terminal, without waiting', async () => {
    const { io, out } = fakeIo(hookStdin({ tool_name: 'AskUserQuestion', tool_input: {} }))
    const rpc = scriptedRpc({
      request: { outcome: 'not_relayed', reason: 'terminal_only_tool' },
      waits: []
    })
    await runPermissionRequestHook(rpc, io)
    expect(out).toEqual([])
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('calls nothing for input it cannot relay', async () => {
    for (const stdin of ['{broken', hookStdin({ hook_event_name: 'PreToolUse' })]) {
      const { io, out } = fakeIo(stdin)
      const rpc = scriptedRpc({ request: RELAYED, waits: [] })
      await runPermissionRequestHook(rpc, io)
      expect(rpc).not.toHaveBeenCalled()
      expect(out).toEqual([])
    }
  })

  it('reports a refusal by its code only and leaves the prompt to the terminal', async () => {
    const { io, out, err } = fakeIo(hookStdin())
    const rpc = scriptedRpc({
      request: new RuntimeClientError(
        'autopilot_permission_caller_refused',
        'detail that must not be printed'
      ),
      waits: []
    })
    await expect(runPermissionRequestHook(rpc, io)).resolves.toBeUndefined()
    expect(out).toEqual([])
    expect(err.join('')).toBe(
      'Permission relay unavailable (autopilot_permission_caller_refused); the prompt stays in the terminal.\n'
    )
  })

  it('refuses to print a decision that is not the documented shape', async () => {
    const { io, out } = fakeIo(hookStdin())
    const forged = {
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'allow', updatedPermissions: [] }
      }
    }
    const rpc = scriptedRpc({ request: RELAYED, waits: [{ state: 'decided', hookOutput: forged }] })
    await runPermissionRequestHook(rpc, io)
    expect(out).toEqual([])
  })

  it('keeps every wait within 20 s and stops before Claude Code cancels the hook', async () => {
    const { io, out, advance, now } = fakeIo(hookStdin())
    const startedAt = now()
    const rpc = scriptedRpc({ request: RELAYED, waits: [{ state: 'pending' }] }, advance)
    await runPermissionRequestHook(rpc, io)
    const waits = rpc.mock.calls.filter(([method]) => method === 'orchestration.permissionWait')
    expect(waits.length).toBeGreaterThan(10)
    for (const [, params, timeoutMs] of waits) {
      expect(params).toMatchObject({ decisionId: DECISION_ID })
      expect(Number(Object(params).waitMs)).toBeLessThanOrEqual(20_000)
      expect(timeoutMs).toBeLessThanOrEqual(25_000)
    }
    expect(now() - startedAt).toBeLessThan(PERMISSION_HOOK_TIMEOUT_SECONDS * 1000)
    expect(out).toEqual([])
  })

  it('retries a failed wait twice, then gives the prompt to the terminal', async () => {
    const recovered = fakeIo(hookStdin())
    const flaky = scriptedRpc({
      request: RELAYED,
      waits: [new Error('socket closed'), { state: 'decided', hookOutput: ALLOW }]
    })
    await runPermissionRequestHook(flaky, recovered.io)
    expect(recovered.out.join('')).toBe(`${JSON.stringify(ALLOW)}\n`)

    const broken = fakeIo(hookStdin())
    const failing = scriptedRpc({ request: RELAYED, waits: [new Error('socket closed')] })
    await runPermissionRequestHook(failing, broken.io)
    expect(
      failing.mock.calls.filter(([method]) => method === 'orchestration.permissionWait')
    ).toHaveLength(3)
    expect(broken.out).toEqual([])
  })
})
