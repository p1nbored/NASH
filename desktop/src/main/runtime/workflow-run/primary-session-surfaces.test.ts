import { describe, expect, it } from 'vitest'
import { AgentLaunchStructuredSessionRefusedError } from '../../agent-launch/agent-launch-surface-factories'
import { trackTerminalSpawnDispatch } from '../../agent-launch/agent-launch-not-started'
import {
  PRIMARY_SESSION_LAUNCH_SOURCE,
  createPrimarySessionSurfaces
} from './primary-session-surfaces'
import { FIXTURE_HANDLE, FIXTURE_PANE, createFakeTerminal } from './primary-session.test-fixture'

const FOCUS_KEYS = ['focus', 'activate', 'presentation', 'rendererBacked'] as const

describe('primary session surfaces', () => {
  it('creates a background terminal that never takes focus and keeps the launch arguments', async () => {
    const { terminal } = createFakeTerminal()
    const surfaces = createPrimarySessionSurfaces(terminal, trackTerminalSpawnDispatch())
    await expect(
      surfaces.createTerminalAgent({
        worktreeId: 'repo::/fixture',
        agent: 'claude',
        startupPrompt: 'Plan the task.',
        agentArgs: "'--permission-mode' 'manual'",
        options: { model: 'claude-opus-5-5', effort: 'max' },
        launchSource: PRIMARY_SESSION_LAUNCH_SOURCE
      })
    ).resolves.toEqual({ handle: FIXTURE_HANDLE, paneKey: FIXTURE_PANE })
    expect(terminal.createTerminal).toHaveBeenCalledOnce()
    const [selector, options] = terminal.createTerminal.mock.calls[0]
    expect(selector).toBe('id:repo::/fixture')
    expect(options).toMatchObject({
      startupAgent: 'claude',
      startupPrompt: 'Plan the task.',
      agentArgs: "'--permission-mode' 'manual'",
      launchPreferences: { model: 'claude-opus-5-5', effort: 'max' },
      launchSource: 'workbench',
      surfaceOwner: false,
      onPtySpawnDispatched: expect.any(Function)
    })
    for (const key of FOCUS_KEYS) {
      expect(options).not.toHaveProperty(key)
    }
  })

  it('refuses a structured session with an error that does not allow a downgrade', async () => {
    const { terminal } = createFakeTerminal()
    const surfaces = createPrimarySessionSurfaces(terminal, trackTerminalSpawnDispatch())
    const attempt = surfaces.createStructuredSession({ worktreeId: 'w', agent: 'claude' })
    await expect(attempt).rejects.toThrow('autopilot_launch_structured_refused')
    await attempt.catch((error: unknown) => {
      expect(error).not.toBeInstanceOf(AgentLaunchStructuredSessionRefusedError)
    })
    expect(terminal.createTerminal).not.toHaveBeenCalled()
  })

  it('tells a create that failed before its spawn request left from one that failed after', async () => {
    const before = createFakeTerminal().terminal
    const failure = new Error('worktree_not_found')
    before.createTerminal.mockRejectedValueOnce(failure)
    const spawnBefore = trackTerminalSpawnDispatch()
    await expect(
      createPrimarySessionSurfaces(before, spawnBefore).createTerminalAgent({
        worktreeId: 'w',
        agent: 'claude'
      })
    ).rejects.toBe(failure)
    expect(spawnBefore.failedBeforeDispatch(failure)).toBe(true)

    const after = createFakeTerminal().terminal
    const late = new Error('pty_spawn_failed')
    after.createTerminal.mockImplementationOnce(async (_selector, options) => {
      options.onPtySpawnDispatched?.()
      throw late
    })
    const spawnAfter = trackTerminalSpawnDispatch()
    await expect(
      createPrimarySessionSurfaces(after, spawnAfter).createTerminalAgent({
        worktreeId: 'w',
        agent: 'claude'
      })
    ).rejects.toBe(late)
    expect(spawnAfter.failedBeforeDispatch(late)).toBe(false)
  })
})
