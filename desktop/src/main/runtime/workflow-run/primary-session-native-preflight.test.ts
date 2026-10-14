import { describe, expect, it } from 'vitest'
import { ROUTING_AGENTS } from '../../../shared/routing-table/routing-cli-registry'
import { runPrimarySessionPreflight } from './primary-session-preflight'
import { buildPrimarySessionPrompt } from './primary-session-prompt'

describe('native primary CLI launch', () => {
  it.each(['muse', 'omp', 'opencode', 'grok'] as const)(
    'refuses %s read-only launches on Windows before building a plan',
    (agent) => {
      expect(
        runPrimarySessionPreflight({
          agent,
          settings: {},
          platform: 'win32',
          access: 'read_only',
          model: 'fixture-model-v1',
          effort: 'none'
        })
      ).toMatchObject({ ok: false, refusal: { code: 'autopilot_session_posture_invalid' } })
    }
  )

  it.each([
    ['gemini', '--approval-mode', 'plan'],
    ['cursor', '--mode', 'ask'],
    ['codebuddy', '--permission-mode', 'plan'],
    ['grok', '--sandbox', 'read-only']
  ] as const)('carries the native read-only control for %s', (agent, flag, value) => {
    const result = runPrimarySessionPreflight({
      agent,
      settings: {},
      platform: 'linux',
      access: 'read_only',
      model: 'fixture-model-v1',
      effort: 'none'
    })
    expect(result.ok, JSON.stringify(result)).toBe(true)
    if (result.ok) {
      expect(result.value.probeCommand).toContain(flag)
      expect(result.value.probeCommand).toContain(value)
    }
  })

  it('preserves Codex none as an explicit provider effort', () => {
    const result = runPrimarySessionPreflight({
      agent: 'codex',
      settings: {},
      platform: 'linux',
      access: 'read_only',
      model: 'gpt-6.1-sol',
      effort: 'none'
    })
    expect(result.ok, JSON.stringify(result)).toBe(true)
    if (result.ok) {
      expect(result.value.sessionOptions.effort).toBe('none')
      expect(result.value.probeCommand).toContain('model_reasoning_effort')
      expect(result.value.probeCommand).toContain('none')
    }
  })

  it.each(['claude'] as const)('omits effort when %s has no model effort option', (agent) => {
    const result = runPrimarySessionPreflight({
      agent,
      settings: {},
      platform: 'linux',
      access: 'read_only',
      settingsFilePath: '/fixture/settings.json',
      agentsJson: null,
      model: 'claude-haiku-4-5-20251001',
      effort: 'none'
    })
    expect(result.ok, JSON.stringify(result)).toBe(true)
    if (result.ok) {
      expect(result.value.sessionOptions).not.toHaveProperty('effort')
      expect(result.value.probeCommand).not.toMatch(/--effort|model_reasoning_effort/)
    }
  })

  it.each(ROUTING_AGENTS.filter((agent) => agent !== 'claude' && agent !== 'codex'))(
    'starts %s with its native model adapter and leaves none effort unset',
    (agent) => {
      const model = agent === 'opencode' ? 'provider/model-v1' : 'fixture-model-v1'
      const result = runPrimarySessionPreflight({
        agent,
        settings: { agentDefaultArgs: { [agent]: '--yolo' } },
        platform: 'linux',
        access: 'workspace_write',
        model,
        effort: 'none'
      })
      expect(result.ok, JSON.stringify(result)).toBe(true)
      if (!result.ok) {
        return
      }
      expect(result.value.sessionOptions).toEqual({
        model,
        taskAccess: 'workspace_write',
        routeValidated: 'true'
      })
      expect(result.value.launchPreferences).toMatchObject({
        model,
        taskAccess: 'workspace_write'
      })
      expect(result.value.probeCommand).not.toMatch(
        /--yolo|--effort|reasoning_effort|bypass|skip-permissions/
      )
    }
  )

  it.each(ROUTING_AGENTS)(
    'identifies %s in a primary prompt with the requested access',
    (agent) => {
      const result = buildPrimarySessionPrompt({
        agent,
        objective: 'Review this folder.',
        access: 'read_only',
        cliCommand: 'nash',
        platform: 'linux'
      })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.text).toContain('primary')
        expect(result.value.text).toContain('do not edit files')
        expect(result.value.text).not.toContain('undefined')
      }
    }
  )

  it('refuses an effort that the native adapter cannot deliver', () => {
    expect(
      runPrimarySessionPreflight({
        agent: 'gemini',
        settings: {},
        platform: 'linux',
        access: 'read_only',
        model: 'fixture-model-v1',
        effort: 'max'
      })
    ).toMatchObject({ ok: false, refusal: { code: 'autopilot_session_startup_plan_mismatch' } })
  })
})
